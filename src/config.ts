// ============================================================
// 全設定ファイル（日本版）
// 情報源の追加・LLM モデルの変更・プロンプト調整はすべてここで行う
// ============================================================

import { Source, Category } from './types';

/** 実行設定 */
export const CONFIG = {
  timezone: 'Asia/Tokyo',
  maxArticlesPerRun: 30,    // 1回の実行で処理する最大記事数
  hoursLookback: 24,        // 過去何時間以内の記事を対象にするか
  batchSize: 5,             // Claude API に1回で渡す記事数
  retryMaxAttempts: 5,      // APIエラー時の最大リトライ回数
  retryBaseDelayMs: 2000,   // リトライの基本待機時間（指数バックオフ）
  fetchTimeoutMs: 12000,    // RSS フェッチのタイムアウト
} as const;

/** Claude API 設定 */
export const CLAUDE_CONFIG = {
  // コスト効率: claude-haiku-4-5-20251001 (~$0.014/日)
  // 高品質優先: claude-sonnet-4-6 (~$0.15/日)
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 4096,
} as const;

// ============================================================
// 情報源の定義（日本の音楽市場に特化）
// 新しいソースを追加する場合はここに追記するだけでよい
// priority: 1=最優先, 2=通常, 3=補足
// trustLevel: official=公式, high=高信頼, medium=中信頼
// ============================================================
export const SOURCES: Source[] = [
  // ---- 音楽業界ニュース（日本語） ----
  {
    name: 'Natalie 音楽',
    url: 'https://natalie.mu/music/feed',
    category: '音楽業界ニュース',
    language: 'ja',
    priority: 1,
    trustLevel: 'high',
  },
  {
    name: 'ORICON NEWS 音楽',
    url: 'https://www.oricon.co.jp/rss/music/',
    category: '音楽業界ニュース',
    language: 'ja',
    priority: 1,
    trustLevel: 'high',
  },
  {
    name: 'Billboard Japan',
    url: 'https://www.billboard-japan.com/d_news/feed/',
    category: '音楽業界ニュース',
    language: 'ja',
    priority: 1,
    trustLevel: 'high',
  },
  {
    name: 'musicman',
    url: 'https://www.musicman.co.jp/feed',
    category: '音楽業界ニュース',
    language: 'ja',
    priority: 1,
    trustLevel: 'high',
  },
  {
    name: 'Barks',
    url: 'https://www.barks.jp/rss/index.xml',
    category: '音楽業界ニュース',
    language: 'ja',
    priority: 2,
    trustLevel: 'medium',
  },
  {
    name: 'CDJournal',
    url: 'https://www.cdjournal.com/main/news/rss',
    category: '音楽業界ニュース',
    language: 'ja',
    priority: 2,
    trustLevel: 'medium',
  },
  {
    name: 'OTOTOY',
    url: 'https://ototoy.jp/news/rss',
    category: '音楽業界ニュース',
    language: 'ja',
    priority: 2,
    trustLevel: 'medium',
  },
  {
    name: 'Skream!',
    url: 'https://skream.jp/rss/news.xml',
    category: '音楽業界ニュース',
    language: 'ja',
    priority: 3,
    trustLevel: 'medium',
  },
  // ---- 公式/プレスリリース ----
  {
    name: 'Spotify Newsroom',
    url: 'https://newsroom.spotify.com/feed/',
    category: '公式/プレスリリース',
    language: 'en',
    priority: 1,
    trustLevel: 'official',
  },
  {
    name: 'Apple Newsroom',
    url: 'https://www.apple.com/newsroom/rss-feed.rss',
    category: '公式/プレスリリース',
    language: 'en',
    priority: 1,
    trustLevel: 'official',
  },
  {
    name: 'YouTube Official Blog',
    url: 'https://blog.youtube/rss/',
    category: '公式/プレスリリース',
    language: 'en',
    priority: 2,
    trustLevel: 'official',
  },
  // ---- テック/AI ----
  {
    name: 'Music Ally',
    url: 'https://musically.com/feed/',
    category: 'テック/AI',
    language: 'en',
    priority: 2,
    trustLevel: 'high',
  },
  {
    name: 'Hypebot',
    url: 'https://www.hypebot.com/hypebot/atom.xml',
    category: 'テック/AI',
    language: 'en',
    priority: 3,
    trustLevel: 'medium',
  },
  // ---- アート/ビジュアル ----
  {
    name: 'Dezeen',
    url: 'https://www.dezeen.com/feed/',
    category: 'アート/ビジュアル',
    language: 'en',
    priority: 3,
    trustLevel: 'medium',
  },
  // ---- ビジネス/投資 ----
  {
    name: 'TechCrunch Japan',
    url: 'https://jp.techcrunch.com/feed/',
    category: 'ビジネス/投資',
    language: 'ja',
    priority: 2,
    trustLevel: 'medium',
  },
];

/** レポートのカテゴリ一覧（順番がそのままレポートの並び順になる） */
export const REPORT_CATEGORIES: Category[] = [
  '芸術性',
  '商業性',
  'トレンド',
  'ビジネス',
  '周辺市場',
];

// ============================================================
// LLM プロンプトテンプレート（日本市場特化）
// 要約品質を改善する場合はここを編集する
// {ARTICLES} / {SUMMARIES} はコード側で置換される
// ============================================================
export const PROMPTS = {
  articleSummary: `あなたは日本の音楽業界に精通した専門アナリストです。以下の記事を分析し、日本語のみで回答してください。企業名・サービス名・作品名・アーティスト名などの固有名詞は原語のまま保持してください。日本市場への影響・関連性を特に重視して分析してください。

記事リスト:
{ARTICLES}

各記事について以下のJSON形式のみで出力してください（コードフェンスや余分なテキスト不要）:
{"articles":[{"title":"日本語タイトル","summary":"何が起きたか・なぜ重要か・日本市場への影響・今後どう見ればいいかを含む3文以内","importance":"high|medium|low","category":"芸術性|商業性|トレンド|ビジネス|周辺市場","signals":"この情報が日本の音楽業界に与えるインプリケーション1文","url":"元記事URL","sourceName":"ソース名"}]}`,

  executiveSummary: `あなたは日本の音楽業界に精通した専門アナリストです。以下の本日の音楽業界ニュース要約から、日本市場において最重要なトピック3〜7つを抽出し、エグゼクティブサマリーを日本語で作成してください。

ニュース一覧:
{SUMMARIES}

以下のJSON形式のみで出力してください（コードフェンスや余分なテキスト不要）:
{"executive_summary":"本日の日本音楽業界全体を俯瞰した概況（2〜3文）","top_topics":[{"topic":"トピック名","significance":"なぜ今日の日本市場で重要なのかの説明"}],"signals_and_insights":["複数の情報源から読み取れる日本市場のトレンドや変化","中長期的に日本の音楽ビジネスに重要な示唆","今後注目すべき動向・企業・アーティスト・サービス"]}`,
};
