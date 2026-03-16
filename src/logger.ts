// ============================================================
// 実行ログを Google Sheet に記録する
// LOG_SHEET_ID が未設定の場合はコンソールログのみ
// ============================================================

import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { RunStats } from './types';

function getAuth(): GoogleAuth {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set');
  const credentials = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * 実行統計を Google Sheet に1行追記する
 * シートの列: 実行日時 | 日付 | 取得記事数 | フィルタ後 | 要約数 | Doc URL | 実行時間 | エラー
 */
export async function logExecution(stats: RunStats): Promise<void> {
  const sheetId = process.env.LOG_SHEET_ID;

  // Sheet ID が未設定ならコンソールのみ
  if (!sheetId) {
    console.log('[logger] LOG_SHEET_ID not set, skipping Sheet log');
    return;
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // ヘッダー行がなければ初回に追加
    await ensureHeaderRow(sheets, sheetId);

    const row = [
      new Date().toISOString(),                           // 実行日時
      stats.date,                                         // 対象日
      stats.articlesFound,                                // 取得記事数
      stats.articlesAfterFilter,                          // フィルタ後記事数
      stats.articlesSummarized,                           // 要約記事数
      stats.docUrl,                                       // Doc URL
      `${(stats.durationMs / 1000).toFixed(1)}s`,        // 実行時間
      stats.errors.length > 0 ? stats.errors.join(' | ') : 'none', // エラー
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:H',
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });

    console.log(`[logger] Execution logged to Sheet: ${sheetId}`);
  } catch (e) {
    // ログ失敗はメインフローを止めない
    console.warn('[logger] Failed to write to Sheet:', e);
  }
}

/**
 * シートにヘッダー行がなければ追加（冪等）
 */
async function ensureHeaderRow(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string
): Promise<void> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1:A1',
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Sheet1!A1:H1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          '実行日時', '対象日', '取得記事数', 'フィルタ後',
          '要約数', 'Doc URL', '実行時間', 'エラー',
        ]],
      },
    });
  }
}
