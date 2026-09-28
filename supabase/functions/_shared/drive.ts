import { gfetch, gjson, jsonBody } from "./google.ts";
import { isMediaMime, type MediaFile } from "./rules.ts";

const api = "https://www.googleapis.com/drive/v3";
const folderMime = "application/vnd.google-apps.folder";
const allDrives = "supportsAllDrives=true&includeItemsFromAllDrives=true";

export interface DriveFolder {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
}

async function listAll<T>(q: string, fields: string, orderBy = "name"): Promise<T[]> {
  const files: T[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q, fields: `nextPageToken, files(${fields})`, pageSize: "1000", orderBy });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gjson<{ files: T[]; nextPageToken?: string }>(`${api}/files?${params}&${allDrives}`);
    files.push(...page.files);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

export function listFolders(parentId: string): Promise<DriveFolder[]> {
  return listAll<DriveFolder>(
    `'${parentId}' in parents and trashed = false and mimeType = '${folderMime}'`,
    "id, name, createdTime, modifiedTime, webViewLink",
  );
}

/** Photos and videos in a folder and all its sub-folders. */
export async function listMedia(folderId: string): Promise<MediaFile[]> {
  const entries = await listAll<DriveFile>(
    `'${folderId}' in parents and trashed = false and ` +
      `(mimeType = '${folderMime}' or mimeType contains 'image/' or mimeType contains 'video/')`,
    "id, name, mimeType, size, md5Checksum",
    "createdTime",
  );
  const media: MediaFile[] = entries
    .filter((f) => f.mimeType !== folderMime && isMediaMime(f.mimeType))
    .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0), md5: f.md5Checksum }));
  for (const sub of entries.filter((f) => f.mimeType === folderMime)) {
    media.push(...await listMedia(sub.id));
  }
  return media;
}

export async function getFolder(folderId: string): Promise<DriveFolder & { parents?: string[] }> {
  return await gjson(`${api}/files/${folderId}?fields=id,name,createdTime,modifiedTime,webViewLink,parents,mimeType&supportsAllDrives=true`);
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  await gfetch(`${api}/files/${folderId}?supportsAllDrives=true&fields=id`, jsonBody({ name }, "PATCH"));
}

export async function trashFile(fileId: string): Promise<void> {
  await gfetch(`${api}/files/${fileId}?supportsAllDrives=true&fields=id`, jsonBody({ trashed: true }, "PATCH"));
}

/** Downloads bytes [start, end) of a Drive file. */
export async function downloadRange(fileId: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  const res = await gfetch(`${api}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Range: `bytes=${start}-${end - 1}` },
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length !== end - start) {
    throw new Error(`Drive returned ${bytes.length} bytes, expected ${end - start}. The file may have changed.`);
  }
  return bytes;
}

export async function createSpreadsheetInFolder(name: string, parentId: string): Promise<string> {
  const file = await gjson<{ id: string }>(
    `${api}/files?supportsAllDrives=true&fields=id`,
    jsonBody({ name, mimeType: "application/vnd.google-apps.spreadsheet", parents: [parentId] }),
  );
  return file.id;
}
