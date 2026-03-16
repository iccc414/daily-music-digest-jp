// ============================================================
// エントリーポイント / オーケストレーター（日本版）
// 全フェーズを順番に実行する
// ============================================================

import 'dotenv/config';
import {
  fetchAllSources,
  filterByDate,
  deduplicateArticles,
  prioritizeArticles,
  markArticlesAsSeen,
} from './fetcher';
import { summarizeArticles, buildExecutiveSummary } from './summarizer';
import { createDailyReport } from './docWriter';
import { getOrCreateDailyFolder } from './driveManager';
import { logExecution } from './logger';
import { CONFIG } from './config';
import { RunStats } from './types';

async function main(): Promise<void> {
  const startTime = Date.now();
  const errors: string[] = [];

  // 日付は JST で取得（GitHub Actions は UTC で動くため明示的に変換）
  const dateStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
  }).format(new Date()); // → YYYY-MM-DD

  console.log('='.repeat(60));
  console.log(`Daily Music Digest JP - ${dateStr}`);
  console.log('='.repeat(60));

  // ---- Phase 1: RSS フェッチ ----
  console.log('\n[Phase 1] Fetching RSS feeds...');
  let rawArticles;
  try {
    rawArticles = await fetchAllSources();
  } catch (e) {
    const msg = `Fatal: RSS fetch failed: ${e}`;
    console.error(msg);
    throw new Error(msg);
  }

  // ---- Phase 2: フィルタ・重複排除・優先度ソート ----
  console.log('\n[Phase 2] Filtering and deduplicating...');
  const recentArticles = filterByDate(rawArticles, CONFIG.hoursLookback);
  const newArticles = deduplicateArticles(recentArticles);
  let topArticles = prioritizeArticles(newArticles, CONFIG.maxArticlesPerRun);

  // フォールバック: 重複排除で全記事が消えた場合は既読を無視して直近の記事を使う
  if (topArticles.length === 0 && recentArticles.length > 0) {
    console.warn('[main] No new articles after dedup — falling back to recent articles (dedup bypassed)');
    topArticles = prioritizeArticles(recentArticles, CONFIG.maxArticlesPerRun);
  }

  if (topArticles.length === 0) {
    console.warn('[main] No articles found at all. Skipping report generation.');
    return;
  }

  console.log(`[main] Processing ${topArticles.length} articles`);

  // ---- Phase 3: LLM 要約 ----
  console.log('\n[Phase 3] Summarizing articles with Claude...');
  let summaries;
  try {
    summaries = await summarizeArticles(topArticles);
  } catch (e) {
    const msg = `Summarization failed: ${e}`;
    console.error(msg);
    errors.push(msg);
    throw new Error(msg);
  }

  let executiveSummary;
  try {
    executiveSummary = await buildExecutiveSummary(summaries);
  } catch (e) {
    const msg = `Executive summary failed: ${e}`;
    console.error(msg);
    errors.push(msg);
    // フォールバック：空のサマリーで続行
    executiveSummary = {
      executive_summary: `${dateStr} の日本音楽業界レポートです。`,
      top_topics: summaries.slice(0, 5).map((s) => ({
        topic: s.title,
        significance: s.signals,
      })),
      signals_and_insights: [],
    };
  }

  // ---- Phase 4: Google Doc 生成（最大3回リトライ） ----
  console.log('\n[Phase 4] Creating Google Doc...');
  let docUrl = '';
  {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const folderId = await getOrCreateDailyFolder(dateStr);
        const result = await createDailyReport(dateStr, folderId, executiveSummary, summaries);
        docUrl = result.docUrl;
        console.log(`[main] Doc URL: ${docUrl}`);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        const msg = `Doc creation attempt ${attempt}/3 failed: ${e}`;
        console.error(msg);
        errors.push(msg);
        if (attempt < 3) {
          console.log(`[main] Waiting ${attempt * 15}s before retry...`);
          await new Promise((r) => setTimeout(r, attempt * 15_000));
        }
      }
    }
    if (lastError) throw new Error(`Doc creation failed after 3 attempts: ${lastError}`);
  }

  // ---- Phase 5: 既読 URL を記録 ----
  markArticlesAsSeen(topArticles);

  // ---- Phase 6: 実行ログ ----
  const durationMs = Date.now() - startTime;
  const stats: RunStats = {
    date: dateStr,
    articlesFound: rawArticles.length,
    articlesAfterFilter: topArticles.length,
    articlesSummarized: summaries.length,
    docUrl,
    durationMs,
    errors,
  };

  await logExecution(stats);

  console.log('\n' + '='.repeat(60));
  console.log(`Done! ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Articles: ${rawArticles.length} fetched → ${topArticles.length} processed → ${summaries.length} summarized`);
  console.log(`Doc: ${docUrl}`);
  if (errors.length > 0) console.warn(`Errors: ${errors.join(', ')}`);
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error('[main] Fatal error:', e);
  process.exit(1);
});
