import { GoogleApiError, gfetch, gjson, jsonBody } from "./google.ts";

const api = "https://photoslibrary.googleapis.com/v1";

export interface Album {
  id: string;
  title: string;
  productUrl?: string;
  mediaItemsCount?: string;
}

/** Albums this app created in the photos@ library (the only ones the API exposes since March 2025). */
export async function listAppAlbums(): Promise<Album[]> {
  const albums: Album[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "50", excludeNonAppCreatedData: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gjson<{ albums?: Album[]; nextPageToken?: string }>(`${api}/albums?${params}`);
    albums.push(...page.albums ?? []);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return albums;
}

export async function getAlbum(albumId: string): Promise<Album | null> {
  try {
    return await gjson<Album>(`${api}/albums/${albumId}`);
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 400 || err.status === 403)) return null;
    throw err;
  }
}

export function createAlbum(title: string): Promise<Album> {
  return gjson<Album>(`${api}/albums`, jsonBody({ album: { title } }));
}

export async function renameAlbum(albumId: string, title: string): Promise<void> {
  await gfetch(`${api}/albums/${albumId}?updateMask=title`, jsonBody({ title }, "PATCH"));
}

/** Starts a resumable upload session and returns its URL. */
export async function startUpload(mimeType: string, size: number): Promise<string> {
  const res = await gfetch(`${api}/uploads`, {
    method: "POST",
    headers: {
      "Content-Length": "0",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Content-Type": mimeType,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Raw-Size": String(size),
    },
  });
  await res.body?.cancel();
  const url = res.headers.get("X-Goog-Upload-URL");
  if (!url) throw new Error("Google Photos did not return an upload URL.");
  return url;
}

/** Bytes Google already has for this session, or null when the session is gone. */
export async function queryUpload(uploadUrl: string): Promise<{ received: number; status: string } | null> {
  try {
    const res = await gfetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Length": "0", "X-Goog-Upload-Command": "query" },
    }, 2);
    await res.body?.cancel();
    return {
      received: Number(res.headers.get("X-Goog-Upload-Size-Received") ?? 0),
      status: res.headers.get("X-Goog-Upload-Status") ?? "active",
    };
  } catch (err) {
    if (err instanceof GoogleApiError && err.status < 500) return null;
    throw err;
  }
}

/** Sends one chunk. Returns the upload token when `final` is true. */
export async function uploadChunk(uploadUrl: string, offset: number, bytes: Uint8Array<ArrayBuffer>, final: boolean): Promise<string | null> {
  const res = await gfetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": final ? "upload, finalize" : "upload",
      "X-Goog-Upload-Offset": String(offset),
    },
    body: bytes,
  }, 2);
  const text = await res.text();
  return final ? text.trim() : null;
}

/** Adds an uploaded file to the album. Returns the new media item id. */
export async function addToAlbum(albumId: string, uploadToken: string, fileName: string): Promise<string> {
  const body = await gjson<{
    newMediaItemResults?: { status?: { code?: number; message?: string }; mediaItem?: { id: string } }[];
  }>(`${api}/mediaItems:batchCreate`, jsonBody({
    albumId,
    newMediaItems: [{ simpleMediaItem: { uploadToken, fileName } }],
  }));
  const result = body.newMediaItemResults?.[0];
  if (!result?.mediaItem?.id || (result.status?.code ?? 0) !== 0) {
    throw new Error(`Google Photos rejected the file: ${result?.status?.message ?? "unknown error"}`);
  }
  return result.mediaItem.id;
}
