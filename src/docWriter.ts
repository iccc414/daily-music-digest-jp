// ============================================================
// Google Docs レポート生成
// googleapis の batchUpdate API を使い、見出し・リンク・箇条書きを
// 一括原子操作で書き込む（GAS の DocumentApp より高品質）
// ============================================================

import { google, docs_v1 } from 'googleapis';
import { SummarizedArticle, ExecutiveSummary, Importance } from './types';
import { REPORT_CATEGORIES } from './config';

function getAuth() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN are not set');
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

/**
 * 日次レポートの Google Doc を新規作成して Drive フォルダに保存
 * docs.documents.create() ではなく drive.files.create() で直接ターゲットフォルダに作成する。
 * これにより moveFileToFolder が不要になり、permission エラーを回避できる。
 */
export async function createDailyReport(
  dateStr: string,
  folderId: string,
  executiveSummary: ExecutiveSummary,
  summaries: SummarizedArticle[]
): Promise<{ docId: string; docUrl: string }> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  // 1. 既存の同名ドキュメントを削除（冪等性確保）
  const existingRes = await drive.files.list({
    q: [
      `name='${dateStr}'`,
      `mimeType='application/vnd.google-apps.document'`,
      `'${folderId}' in parents`,
      `trashed=false`,
    ].join(' and '),
    fields: 'files(id)',
    spaces: 'drive',
  });
  if (existingRes.data.files && existingRes.data.files.length > 0) {
    console.log(`[docWriter] Deleting ${existingRes.data.files.length} existing document(s) named "${dateStr}"`);
    for (const file of existingRes.data.files) {
      await drive.files.delete({ fileId: file.id! });
    }
  }

  // 2. Drive API で直接ターゲットフォルダに Google Doc を作成
  console.log(`[docWriter] Creating document: ${dateStr} in folder ${folderId}`);
  const createRes = await drive.files.create({
    requestBody: {
      name: dateStr,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
    },
    fields: 'id',
  });
  const docId = createRes.data.id!;

  // 3. レポート本文を batchUpdate で書き込み
  const requests = buildBatchRequests(executiveSummary, summaries);
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
  console.log(`[docWriter] Document created: ${docUrl}`);
  return { docId, docUrl };
}

// ============================================================
// batchUpdate リクエスト構築
//
// 設計方針:
//   - テキストを末尾から逆順に挿入することでインデックスがずれない
//   - セグメントリストを作成 → 逆順変換 → requests 配列を生成
// ============================================================

interface Segment {
  text: string;
  style?: string;         // HEADING_1 / HEADING_2 / HEADING_3 / NORMAL_TEXT
  bold?: boolean;
  link?: string;
  bullet?: boolean;
}

function buildBatchRequests(
  exec: ExecutiveSummary,
  summaries: SummarizedArticle[]
): docs_v1.Schema$Request[] {
  const segments: Segment[] = [];

  // ---- 1. Executive Summary ----
  segments.push({ text: '1. Executive Summary\n', style: 'HEADING_1' });
  segments.push({ text: exec.executive_summary + '\n\n' });

  if (exec.top_topics.length > 0) {
    segments.push({ text: '【最重要トピック】\n', bold: true });
    exec.top_topics.forEach((t, i) => {
      segments.push({ text: `${i + 1}. ${t.topic}\n` });
      segments.push({ text: `   → ${t.significance}\n` });
    });
  }
  segments.push({ text: '\n' });

  // ---- 2. Top News ----
  segments.push({ text: '2. Top News\n', style: 'HEADING_1' });
  const sorted = [...summaries].sort(
    (a, b) => importanceOrder(a.importance) - importanceOrder(b.importance)
  );
  for (const article of sorted) {
    segments.push({ text: article.title + '\n', style: 'HEADING_3' });
    segments.push({ text: article.summary + '\n' });
    segments.push({
      text: `重要度: ${importanceLabel(article.importance)} | カテゴリ: ${article.category}\n`,
    });
    segments.push({
      text: `ソース: ${article.sourceName}  →  ${article.url}\n`,
      link: article.url,
    });
    segments.push({ text: '\n' });
  }

  // ---- 3. Category Breakdown ----
  segments.push({ text: '3. Category Breakdown\n', style: 'HEADING_1' });
  for (const cat of REPORT_CATEGORIES) {
    const catArticles = summaries.filter((s) => s.category === cat);
    if (catArticles.length === 0) continue;
    segments.push({ text: `${cat}\n`, style: 'HEADING_2' });
    for (const a of catArticles) {
      segments.push({ text: `• ${a.title}\n` });
      segments.push({ text: `  ${a.signals}\n` });
    }
    segments.push({ text: '\n' });
  }

  // ---- 4. Signals & Insights ----
  segments.push({ text: '4. Signals & Insights\n', style: 'HEADING_1' });
  if (exec.signals_and_insights.length > 0) {
    for (const insight of exec.signals_and_insights) {
      segments.push({ text: `• ${insight}\n` });
    }
  } else {
    segments.push({ text: '本日は特筆すべきシグナルはありませんでした。\n' });
  }
  segments.push({ text: '\n' });

  // ---- 5. Source List ----
  segments.push({ text: '5. Source List\n', style: 'HEADING_1' });
  const seenUrls = new Set<string>();
  let sourceIndex = 1;
  for (const s of summaries) {
    if (seenUrls.has(s.url)) continue;
    seenUrls.add(s.url);
    segments.push({
      text: `${sourceIndex}. [${s.sourceName}] ${s.title}\n`,
      link: s.url,
    });
    sourceIndex++;
  }

  // セグメントを batchUpdate requests に変換
  return segmentsToBatchRequests(segments);
}

/**
 * セグメント配列 → batchUpdate requests 配列
 *
 * Google Docs の batchUpdate で末尾追記する際の注意点:
 * 同一 batchUpdate 内で後ろから挿入する場合、先に挿入されたテキストの
 * インデックスが変わらないよう、**逆順で**リクエストを生成する必要がある。
 *
 * ここではまず全セグメントのテキスト挿入 + スタイル付与リクエストを
 * 「先頭からの累積インデックス」で計算し、最後に reverse() する。
 */
function segmentsToBatchRequests(segments: Segment[]): docs_v1.Schema$Request[] {
  const insertRequests: docs_v1.Schema$Request[] = [];
  const styleRequests: docs_v1.Schema$Request[] = [];
  let cursor = 1; // Google Docs は index 1 から始まる

  for (const seg of segments) {
    const start = cursor;
    const end = cursor + seg.text.length;

    // テキスト挿入はすべて index:1 に積む（逆順で処理することで最終的な位置がforwardと一致）
    insertRequests.push({
      insertText: {
        location: { index: 1 },
        text: seg.text,
      },
    });

    // スタイルはforward計算のインデックスで積む（全挿入後に適用）
    if (seg.style && seg.style !== 'NORMAL_TEXT') {
      styleRequests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: { namedStyleType: seg.style as any },
          fields: 'namedStyleType',
        },
      });
    }

    if (seg.bold) {
      styleRequests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: end - 1 },
          textStyle: { bold: true },
          fields: 'bold',
        },
      });
    }

    if (seg.link) {
      styleRequests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: end - 1 },
          textStyle: { link: { url: seg.link } },
          fields: 'link',
        },
      });
    }

    cursor = end;
  }

  // insertRequestsを逆順にすることで最後のセグメントが最初にindex:1へ挿入され、
  // 結果的にforward順の最終インデックスと一致する。
  // スタイルは全テキスト挿入後に適用する。
  return [...insertRequests.reverse(), ...styleRequests];
}

// ---- ヘルパー ----

function importanceOrder(imp: Importance): number {
  return { high: 0, medium: 1, low: 2 }[imp];
}

function importanceLabel(imp: Importance): string {
  return { high: '高', medium: '中', low: '低' }[imp];
}
