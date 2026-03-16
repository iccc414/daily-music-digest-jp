// ============================================================
// Claude API を使った記事の要約処理
// バッチ処理・リトライ・JSON 抽出を含む
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { Article, SummarizedArticle, ExecutiveSummary } from './types';
import { CONFIG, CLAUDE_CONFIG, PROMPTS } from './config';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('CLAUDE_API_KEY is not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * 記事リストを CONFIG.batchSize 件ずつまとめて Claude に要約させる
 */
export async function summarizeArticles(articles: Article[]): Promise<SummarizedArticle[]> {
  // バッチ分割
  const batches: Article[][] = [];
  for (let i = 0; i < articles.length; i += CONFIG.batchSize) {
    batches.push(articles.slice(i, i + CONFIG.batchSize));
  }

  console.log(`[summarizer] Summarizing ${articles.length} articles in ${batches.length} batches...`);

  const results: SummarizedArticle[] = [];
  for (let i = 0; i < batches.length; i++) {
    console.log(`[summarizer] Batch ${i + 1}/${batches.length}...`);
    try {
      const batchResults = await retryWithBackoff(() => summarizeBatch(batches[i]));
      results.push(...batchResults);
    } catch (e) {
      console.error(`[summarizer] Batch ${i + 1} failed after retries:`, e);
      // バッチが完全に失敗した場合はスキップして続行
    }
  }

  console.log(`[summarizer] Summarized ${results.length} articles total`);
  return results;
}

/**
 * 1バッチ分の記事を要約
 */
async function summarizeBatch(articles: Article[]): Promise<SummarizedArticle[]> {
  const articlesText = articles
    .map(
      (a, i) =>
        `[${i + 1}] タイトル: ${a.title}\nURL: ${a.url}\nソース: ${a.source.name} (${a.source.category})\n本文抜粋: ${a.description}`
    )
    .join('\n\n---\n\n');

  const prompt = PROMPTS.articleSummary.replace('{ARTICLES}', articlesText);
  const text = await callClaude(prompt);
  const parsed = extractJSON<{ articles: SummarizedArticle[] }>(text);

  if (!parsed?.articles) {
    console.warn('[summarizer] Could not parse articles from response');
    return [];
  }

  // URL がない場合は元記事の URL で補完
  return parsed.articles.map((item, i) => ({
    ...item,
    url: item.url || articles[i]?.url || '',
    sourceName: item.sourceName || articles[i]?.source.name || '',
  }));
}

/**
 * 全要約からエグゼクティブサマリーを生成
 */
export async function buildExecutiveSummary(
  summaries: SummarizedArticle[]
): Promise<ExecutiveSummary> {
  const summariesText = summaries
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n重要度: ${s.importance} | カテゴリ: ${s.category}\n要約: ${s.summary}\nシグナル: ${s.signals}`
    )
    .join('\n\n---\n\n');

  const prompt = PROMPTS.executiveSummary.replace('{SUMMARIES}', summariesText);

  console.log('[summarizer] Building executive summary...');
  const text = await retryWithBackoff(() => callClaude(prompt));
  const parsed = extractJSON<ExecutiveSummary>(text);

  if (!parsed) {
    console.warn('[summarizer] Could not parse executive summary, using fallback');
    return {
      executive_summary: '本日の音楽業界レポートです。',
      top_topics: summaries.slice(0, 5).map((s) => ({
        topic: s.title,
        significance: s.signals,
      })),
      signals_and_insights: [],
    };
  }

  return parsed;
}

/**
 * Claude API を呼び出してテキストレスポンスを返す
 */
async function callClaude(prompt: string): Promise<string> {
  const response = await getClient().messages.create({
    model: CLAUDE_CONFIG.model,
    max_tokens: CLAUDE_CONFIG.maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}

/**
 * LLM のレスポンスから JSON を抽出する
 * コードフェンス付き・なし両対応、フォールバックとして正規表現も使用
 */
function extractJSON<T>(text: string): T | null {
  // パターン1: コードフェンスを除去
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;

  // パターン2: 直接パース
  try {
    return JSON.parse(candidate.trim()) as T;
  } catch {
    // pass
  }

  // パターン3: 最初の { ... } を抽出して再試行
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T;
    } catch {
      // pass
    }
  }

  console.warn('[summarizer] Failed to extract JSON. Response preview:', text.slice(0, 200));
  return null;
}

/**
 * 指数バックオフ付きリトライ
 * 1回目失敗後 1s、2回目失敗後 2s、3回目失敗後 4s 待機
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempt = 1
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (attempt >= CONFIG.retryMaxAttempts) throw e;
    const delayMs = CONFIG.retryBaseDelayMs * Math.pow(2, attempt - 1);
    console.warn(`[summarizer] Retry ${attempt}/${CONFIG.retryMaxAttempts} after ${delayMs}ms`);
    await sleep(delayMs);
    return retryWithBackoff(fn, attempt + 1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
