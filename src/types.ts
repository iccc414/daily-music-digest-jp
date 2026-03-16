// ============================================================
// 型定義
// ============================================================

export type Category = '芸術性' | '商業性' | 'トレンド' | 'ビジネス' | '周辺市場';
export type TrustLevel = 'official' | 'high' | 'medium';
export type Priority = 1 | 2 | 3;
export type Importance = 'high' | 'medium' | 'low';

/** 情報源の定義 */
export interface Source {
  name: string;
  url: string;
  category: string;
  language: 'en' | 'ja';
  priority: Priority;
  trustLevel: TrustLevel;
}

/** RSS から取得した生の記事 */
export interface Article {
  title: string;
  url: string;
  description: string;
  pubDate: Date;
  source: Source;
}

/** LLM による要約済み記事 */
export interface SummarizedArticle {
  title: string;        // 日本語タイトル
  summary: string;      // 何が・なぜ・誰に・今後を含む3文以内の要約
  importance: Importance;
  category: Category;
  signals: string;      // 業界インプリケーション1文
  url: string;
  sourceName: string;
}

/** エグゼクティブサマリー */
export interface ExecutiveSummary {
  executive_summary: string;
  top_topics: { topic: string; significance: string }[];
  signals_and_insights: string[];
}

/** 実行統計（ログ用） */
export interface RunStats {
  date: string;
  articlesFound: number;
  articlesAfterFilter: number;
  articlesSummarized: number;
  docUrl: string;
  durationMs: number;
  errors: string[];
}
