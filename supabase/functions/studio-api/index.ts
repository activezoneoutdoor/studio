// AZO Studio API. Every action requires a signed-in @activezoneoutdoor.cy operator.
// Google calls run as the connected photos@ account.

import { requireOperator } from "../_shared/auth.ts";
import { config } from "../_shared/config.ts";
import { adminClient } from "../_shared/db.ts";
import { listFolders, listMedia } from "../_shared/drive.ts";
import { getConnection, mapLimit } from "../_shared/google.ts";
import { corsHeaders, errorResponse, HttpError, json } from "../_shared/http.ts";
import { consentUrl } from "../_shared/oauth.ts";
import { listAppAlbums } from "../_shared/photos.ts";
import { folderNameIssues } from "../_shared/folderName.ts";
import { classifyFolder, sortYearFolders } from "../_shared/rules.ts";
import { logSheetUrl } from "../_shared/sheets.ts";
import { cancelTransfer, renameManagedFolder, requireYearFolder, startTransfer, stepTransfer } from "../_shared/transfer.ts";

const db = () => adminClient();

function canTransfer(email: string): boolean {
  return config.transferEmails.includes(email.toLowerCase());
}

function requireTransferAccess(email: string) {
  if (!canTransfer(email)) throw new HttpError(403, "Transfers are limited to approved accounts for now.");
}

async function status(email: string) {
  const connection = await getConnection();
  const { data: lastJob } = await db().from("transfer_jobs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const logId = Deno.env.get("LOG_SPREADSHEET_ID") ?? connection?.log_spreadsheet_id;
  return {
    connected: !!connection,
    accountEmail: connection?.email ?? null,
    expectedEmail: config.photosAccountEmail,
    rootFolderUrl: `https://drive.google.com/drive/folders/${config.driveRootFolderId}`,
    logSheetUrl: logId ? logSheetUrl(logId) : null,
    canTransfer: canTransfer(email),
    lastJob: lastJob ?? null,
  };
}

interface AlbumRow {
  drive_folder_id: string;
  album_id: string;
  title: string;
  product_url: string | null;
  last_transfer_at: string | null;
}

async function years() {
  return sortYearFolders(await listFolders(config.driveRootFolderId)).map((f) => ({ id: f.id, name: f.name.trim() }));
}

async function folders(yearId: unknown) {
  const year = await requireYearFolder(yearId);
  const [driveFolders, albumsResult, jobsResult] = await Promise.all([
    listFolders(year.id),
    db().from("photo_albums").select("drive_folder_id, album_id, title, product_url, last_transfer_at"),
    db().from("transfer_jobs").select("*").eq("status", "running"),
  ]);
  if (albumsResult.error) throw albumsResult.error;
  if (jobsResult.error) throw jobsResult.error;

  const albums = new Map<string, AlbumRow>(albumsResult.data.map((a: AlbumRow) => [a.drive_folder_id, a]));

  // Link folders to albums this app created earlier under the same title.
  if (driveFolders.some((f) => !albums.has(f.id))) {
    const mappedIds = new Set([...albums.values()].map((a) => a.album_id));
    const appAlbums = await listAppAlbums();
    for (const folder of driveFolders.filter((f) => !albums.has(f.id))) {
      const match = appAlbums.find((a) => a.title === folder.name && !mappedIds.has(a.id));
      if (!match) continue;
      const row = { drive_folder_id: folder.id, album_id: match.id, title: match.title, product_url: match.productUrl ?? null, last_transfer_at: null };
      const { error } = await db().from("photo_albums").insert(row);
      if (!error) {
        albums.set(folder.id, row);
        mappedIds.add(match.id);
      }
    }
  }

  const mediaCounts = await mapLimit(driveFolders, 8, async (f) => (await listMedia(f.id)).length);
  return driveFolders.map((folder, i) => {
    const album = albums.get(folder.id) ?? null;
    return {
      id: folder.id,
      name: folder.name,
      nameIssues: folderNameIssues(folder.name, year.name.trim()),
      url: folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}`,
      createdTime: folder.createdTime,
      mediaCount: mediaCounts[i],
      status: classifyFolder(mediaCounts[i], !!album),
      album: album && { id: album.album_id, title: album.title, url: album.product_url, lastTransferAt: album.last_transfer_at },
      runningJob: jobsResult.data.find((j: { drive_folder_id: string }) => j.drive_folder_id === folder.id) ?? null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const operator = await requireOperator(req);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    switch (body.action) {
      case "status":
        return json(await status(operator.email));
      case "connect-url":
        return json({ url: await consentUrl(operator.email) });
      case "years":
        return json({ years: await years() });
      case "folders":
        return json({ folders: await folders(body.yearId) });
      case "rename":
        return json({ name: await renameManagedFolder(body.folderId, body.name) });
      case "transfer-start":
        requireTransferAccess(operator.email);
        return json({ job: await startTransfer(operator, body.folderId, body.title) });
      case "transfer-step":
        requireTransferAccess(operator.email);
        return json(await stepTransfer(body.jobId));
      case "transfer-cancel":
        requireTransferAccess(operator.email);
        return json({ job: await cancelTransfer(body.jobId) });
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (err) {
    return errorResponse(err);
  }
});
