// ============================================================
// Google Drive フォルダ階層管理
// ROOT / YYYY / YYYY-MM の構造を自動生成
// ============================================================

import { google, drive_v3 } from 'googleapis';

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
 * 日付文字列 (YYYY-MM-DD) に対応する Drive フォルダを取得または作成する
 * 構造: ROOT / YYYY / YYYY-MM
 * 戻り値: YYYY-MM フォルダの ID
 */
export async function getOrCreateDailyFolder(dateStr: string): Promise<string> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const rootId = process.env.DRIVE_FOLDER_ID;
  if (!rootId) throw new Error('DRIVE_FOLDER_ID is not set');

  // YYYY-MM-DD → 2026, 2026-03
  const year = dateStr.slice(0, 4);
  const yearMonth = dateStr.slice(0, 7);

  console.log(`[drive] Ensuring folder structure: ${rootId}/${year}/${yearMonth}`);

  const yearFolderId = await getOrCreateFolder(drive, year, rootId);
  const monthFolderId = await getOrCreateFolder(drive, yearMonth, yearFolderId);

  return monthFolderId;
}

/**
 * 指定の親フォルダ下に指定名のフォルダを取得または作成する
 */
async function getOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string
): Promise<string> {
  // 既存チェック
  const res = await drive.files.list({
    q: [
      `name='${name}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      `trashed=false`,
    ].join(' and '),
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  // 新規作成
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  console.log(`[drive] Created folder: ${name} (id: ${created.data.id})`);
  return created.data.id!;
}

/**
 * Google Doc ファイルを指定フォルダに移動する
 * （Doc は作成時にルートに置かれるため）
 */
export async function moveFileToFolder(
  fileId: string,
  targetFolderId: string
): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  // 現在の親フォルダを取得
  const file = await drive.files.get({ fileId, fields: 'parents' });
  const currentParents = (file.data.parents ?? []).join(',');

  // 移動
  await drive.files.update({
    fileId,
    addParents: targetFolderId,
    removeParents: currentParents,
    fields: 'id, parents',
  });

  console.log(`[drive] Moved file ${fileId} to folder ${targetFolderId}`);
}
