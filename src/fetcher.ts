// ============================================================
// RSS フェッチ・パース・フィルタ・重複排除
// ============================================================

import Parser from 'rss-parser';
import * as fs from 'fs';
import * as path from 'path';
import { Article, Source } from './types';
import { CONFIG, SOURCES } from './config';

const parser = new Parser({
  timeout: CONFIG.fetchTimeoutMs,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; DailyMusicDigest/1.0)',
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: ['media:content', 'media:thumbnail'],
  },
});

// 重複排除用 URL リストの保存パス（GitHub Actions の Cache でマウントされる）
const SEEN_URLS_PATH = path.join(process.cwd(), 'data', 'seen-urls.json');

/**
 * 全ソースを並列フェッチ。1つのソースが失敗しても他は続行する。
 */
export async function fetchAllSources(): Promise<Article[]> {
  console.log(`[fetcher] Fetching ${SOURCES.length} sources in parallel...`);

  const results = await Promise.allSettled(
    SOURCES.map((source) => fetchSource(source))
  );

  const articles: Article[] = [];
  let successCount = 0;
  let failCount = 0;

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
      successCount++;
    } else {
      console.warn(`[fetcher] WARN: Failed to fetch ${SOURCES[i].name}: ${result.reason}`);
      failCount++;
    }
  });

  console.log(`[fetcher] Fetch complete: ${successCount} success, ${failCount} failed, ${articles.length} total articles`);
  return articles;
}

/**
 * 単一ソースをフェッチしてパース（最大3回リトライ）
 */
async function fetchSource(source: Source): Promise<Article[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const feed = await parser.parseURL(source.url);
      return (feed.items ?? [])
        .map((item) => ({
          title: (item.title ?? '').trim(),
          url: (item.link ?? item.guid ?? '').trim(),
          description: cleanDescription(
            item.contentSnippet ?? item.content ?? item['summary'] ?? item.title ?? ''
          ),
          pubDate: item.pubDate ? new Date(item.pubDate) : new Date(0),
          source,
        }))
        .filter((a) => a.url && a.title);
    } catch (e) {
      lastError = e;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 5000 * attempt));
        console.warn(`[fetcher] Retry ${attempt}/3 for ${source.name}`);
      }
    }
  }
  throw lastError;
}

/**
 * 本文テキストを整形（HTML タグ除去・長さ制限）
 */
function cleanDescription(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')  // HTML タグ除去
    .replace(/\s+/g, ' ')       // 連続空白を1つに
    .trim()
    .slice(0, 600);             // 長すぎる場合は切り詰め
}

/**
 * 過去 N 時間以内に公開された記事のみを返す
 */
export function filterByDate(articles: Article[], hoursLookback: number): Article[] {
  const cutoff = Date.now() - hoursLookback * 60 * 60 * 1000;
  const filtered = articles.filter((a) => {
    // pubDate が 0 (不明) の場合は含める
    return a.pubDate.getTime() === 0 || a.pubDate.getTime() > cutoff;
  });
  console.log(`[fetcher] Date filter: ${articles.length} → ${filtered.length} articles (last ${hoursLookback}h)`);
  return filtered;
}

/**
 * 過去に処理済みの記事 URL を除外する
 */
export function deduplicateArticles(articles: Article[]): Article[] {
  const seenUrls = loadSeenUrls();
  const seenSet = new Set(seenUrls);
  const newArticles = articles.filter((a) => !seenSet.has(a.url));
  console.log(`[fetcher] Dedup: ${articles.length} → ${newArticles.length} new articles (${seenSet.size} previously seen)`);
  return newArticles;
}

/**
 * 処理済み記事の URL を保存する（最新 500 件の循環バッファ）
 */
export function markArticlesAsSeen(articles: Article[]): void {
  const seenUrls = loadSeenUrls();
  const newUrls = articles.map((a) => a.url);
  const merged = [...seenUrls, ...newUrls].slice(-500); // 古いものから削除
  saveSeenUrls(merged);
  console.log(`[fetcher] Marked ${newUrls.length} articles as seen (total: ${merged.length})`);
}

/**
 * 優先度順ソート → 上位 N 件に絞る
 */
export function prioritizeArticles(articles: Article[], maxCount: number): Article[] {
  const prioritized = articles
    .sort((a, b) => {
      // priority 昇順（1が最高優先）
      const priorityDiff = a.source.priority - b.source.priority;
      if (priorityDiff !== 0) return priorityDiff;
      // 同一優先度は新しい記事を優先
      return b.pubDate.getTime() - a.pubDate.getTime();
    })
    .slice(0, maxCount);

  console.log(`[fetcher] Prioritized: ${articles.length} → ${prioritized.length} articles`);
  return prioritized;
}

// ---- seen-urls の永続化 ----

function loadSeenUrls(): string[] {
  try {
    if (fs.existsSync(SEEN_URLS_PATH)) {
      const raw = fs.readFileSync(SEEN_URLS_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[fetcher] Could not load seen-urls.json, starting fresh');
  }
  return [];
}

function saveSeenUrls(urls: string[]): void {
  try {
    const dir = path.dirname(SEEN_URLS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SEEN_URLS_PATH, JSON.stringify(urls, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[fetcher] Could not save seen-urls.json:', e);
  }
}
