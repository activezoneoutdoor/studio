// Google Drive access as a staff account (Content manager of the albums Shared Drive), authorised once via OAuth.
// With the drive.file scope the app only sees the folders and files it created itself.
import { admin, type EventRow } from "./db.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const EVENT_TIME_ZONE = "Asia/Nicosia";

export type DriveFile = { id: string; name: string; mimeType: string; size?: string; parents?: string[] };

let cachedToken: { value: string; expiresAt: number } | null = null;

function sharedDriveId(): string {
  const id = Deno.env.get("AZO_SHARED_DRIVE_ID");
  if (!id) throw new Error("AZO_SHARED_DRIVE_ID is not set.");
  return id;
}

/** Exchanges the stored OAuth refresh token (one-time consent by a staff account) for an access token. */
export async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN must be set.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.error === "invalid_grant") {
      throw new Error("Google Drive authorisation expired or was revoked. Redo the consent step in the README and update GOOGLE_OAUTH_REFRESH_TOKEN.");
    }
    throw new Error(`Google token request failed: ${res.status} ${JSON.stringify(body)}`);
  }

  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

async function drive(path: string, init: RequestInit = {}, params: Record<string, string> = {}): Promise<Response> {
  const url = new URL(path.startsWith("http") ? path : `${DRIVE}${path}`);
  url.searchParams.set("supportsAllDrives", "true");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await accessToken()}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=UTF-8");

  const res = await fetch(url, { ...init, headers });
  if (!res.ok && res.status !== 404) throw new Error(`Drive ${init.method ?? "GET"} ${url.pathname} failed: ${res.status} ${await res.text()}`);
  return res;
}

async function listFolders(name: string, parentId: string): Promise<string[]> {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const list = await drive("/files", {}, {
    q: `name = '${escaped}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    corpora: "drive",
    driveId: sharedDriveId(),
    includeItemsFromAllDrives: "true",
    orderBy: "createdTime",
    fields: "files(id)",
  });
  return ((await list.json()).files ?? []).map((file: { id: string }) => file.id);
}

async function trash(fileId: string): Promise<void> {
  await drive(`/files/${encodeURIComponent(fileId)}`, { method: "PATCH", body: JSON.stringify({ trashed: true }) }, { fields: "id" });
}

/**
 * Returns the folder with this name in the parent, creating it if missing. Uploads can start at the same moment,
 * so after creating, the oldest same-named folder wins and any extra one we made is trashed.
 */
export async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const [existing] = await listFolders(name, parentId);
  if (existing) return existing;

  const created = await drive("/files", {
    method: "POST",
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  }, { fields: "id" });
  const createdId: string = (await created.json()).id;

  const [oldest] = await listFolders(name, parentId);
  if (oldest && oldest !== createdId) {
    await trash(createdId);
    return oldest;
  }
  return createdId;
}

function folderPart(value: string): string {
  return value
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "Event";
}

/** e.g. 2026-09-27_SUP_Ayia-Napa, using the event's local date in Cyprus. */
export function eventFolderName(event: Pick<EventRow, "starts_at" | "activity" | "location_name">): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(event.starts_at));
  return `${date}_${folderPart(event.activity)}_${folderPart(event.location_name)}`;
}

/** Returns the event's Drive folder, creating <year>/<event folder> in the Shared Drive on first use. */
export async function ensureEventFolder(event: EventRow): Promise<string> {
  if (event.drive_folder_id) return event.drive_folder_id;

  const name = eventFolderName(event);
  const yearFolder = await findOrCreateFolder(name.slice(0, 4), sharedDriveId());
  const folderId = await findOrCreateFolder(name, yearFolder);

  const { data, error } = await admin()
    .from("events")
    .update({ drive_folder_id: folderId })
    .eq("id", event.id)
    .is("drive_folder_id", null)
    .select("drive_folder_id")
    .maybeSingle();
  if (error) throw error;
  if (data) return folderId;

  // Another upload stored its folder first; use that one and trash ours if it differs.
  const { data: current, error: readError } = await admin().from("events").select("drive_folder_id").eq("id", event.id).single();
  if (readError) throw readError;
  if (current.drive_folder_id !== folderId) await trash(folderId);
  return current.drive_folder_id;
}

/**
 * Starts a resumable upload into the folder and returns the session URL.
 * Passing the browser's Origin lets the participant's browser upload the bytes straight to Google.
 */
export async function startResumableUpload(opts: {
  folderId: string;
  name: string;
  mimeType: string;
  size: number;
  origin: string;
  description?: string;
}): Promise<string> {
  const res = await drive(`${DRIVE_UPLOAD}/files`, {
    method: "POST",
    headers: {
      "X-Upload-Content-Type": opts.mimeType,
      "X-Upload-Content-Length": String(opts.size),
      "Origin": opts.origin,
    },
    body: JSON.stringify({ name: opts.name, parents: [opts.folderId], description: opts.description }),
  }, { uploadType: "resumable", fields: "id,name,mimeType,size,parents" });

  const location = res.headers.get("Location");
  if (!location) throw new Error("Drive did not return an upload session URL.");
  return location;
}

export async function getFile(fileId: string): Promise<DriveFile | null> {
  const res = await drive(`/files/${encodeURIComponent(fileId)}`, {}, { fields: "id,name,mimeType,size,parents" });
  return res.status === 404 ? null : await res.json();
}

/** Makes a file viewable by anyone with its link (needed for the public album), or removes that access. */
export async function setPublicLink(fileId: string, isPublic: boolean): Promise<void> {
  const id = encodeURIComponent(fileId);
  if (isPublic) {
    await drive(`/files/${id}/permissions`, {
      method: "POST",
      body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false }),
    }, { fields: "id" });
  } else {
    await drive(`/files/${id}/permissions/anyoneWithLink`, { method: "DELETE" });
  }
}
