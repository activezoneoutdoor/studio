import { config } from "./config.ts";
import { adminClient } from "./db.ts";
import { downloadRange, getFolder, listMedia, renameFolder, trashFile, type DriveFolder } from "./drive.ts";
import { HttpError } from "./http.ts";
import * as photos from "./photos.ts";
import { isDuplicate, nextChunk, validateFolderName, type LedgerEntry } from "./rules.ts";
import { appendItemRow, type JobSummary, writeSummary } from "./sheets.ts";
import type { Operator } from "./auth.ts";

export interface TransferJob extends JobSummary {
  drive_folder_id: string;
  album_id: string;
}

interface TransferItem {
  id: string;
  job_id: string;
  drive_file_id: string;
  name: string;
  mime_type: string;
  size: number;
  md5: string | null;
  duplicate: boolean;
  status: string;
  upload_url: string | null;
  bytes_sent: number;
  media_item_id: string | null;
}

const db = () => adminClient();
const activeStatuses = ["pending", "uploading", "uploaded"];
const lease = () => new Date(Date.now() + 5 * 60_000).toISOString();
const unlocked = () => `locked_until.is.null,locked_until.lt.${new Date().toISOString()}`;

function check<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw error;
  return data;
}

function list<T>(result: { data: T[] | null; error: unknown }): T[] {
  return check(result) ?? [];
}

function one<T>(result: { data: T | null; error: unknown }): T {
  const data = check(result);
  if (!data) throw new HttpError(404, "Not found.");
  return data;
}

/** Only direct sub-folders of the configured Drive root can be touched. */
export async function requireManagedFolder(folderId: unknown): Promise<DriveFolder> {
  if (typeof folderId !== "string" || !/^[\w-]{10,}$/.test(folderId)) throw new HttpError(400, "Unknown folder.");
  const folder = await getFolder(folderId);
  if (!folder.parents?.includes(config.driveRootFolderId)) throw new HttpError(403, "That folder is not managed by AZO Studio.");
  return folder;
}

export async function renameManagedFolder(folderId: unknown, rawName: unknown): Promise<string> {
  const folder = await requireManagedFolder(folderId);
  let name: string;
  try {
    name = validateFolderName(rawName);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  if (name !== folder.name) await renameFolder(folder.id, name);

  const mapping = check(await db().from("photo_albums").select("album_id, title").eq("drive_folder_id", folder.id).maybeSingle());
  if (mapping && mapping.title !== name) {
    await photos.renameAlbum(mapping.album_id, name);
    check(await db().from("photo_albums").update({ title: name }).eq("drive_folder_id", folder.id));
  }
  return name;
}

/** The album mapped to this folder, or an app-created album with the same title, or a new album. */
async function findOrCreateAlbum(folderId: string, title: string): Promise<photos.Album> {
  const mapping = check(await db().from("photo_albums").select("album_id").eq("drive_folder_id", folderId).maybeSingle());
  let album = mapping ? await photos.getAlbum(mapping.album_id) : null;
  if (!album) {
    const mapped = new Set(list(await db().from("photo_albums").select("album_id")).map((r: { album_id: string }) => r.album_id));
    album = (await photos.listAppAlbums()).find((a) => a.title === title && !mapped.has(a.id)) ?? await photos.createAlbum(title);
  } else if (album.title !== title) {
    await photos.renameAlbum(album.id, title);
    album.title = title;
  }
  check(await db().from("photo_albums").upsert({
    drive_folder_id: folderId, album_id: album.id, title, product_url: album.productUrl ?? null,
  }));
  return album;
}

async function uploadedLedger(albumId: string, fileIds: string[]): Promise<{ album: LedgerEntry[]; anywhere: Set<string> }> {
  const jobIds = list(await db().from("transfer_jobs").select("id").eq("album_id", albumId)).map((j: { id: string }) => j.id);
  const album: LedgerEntry[] = [];
  for (let i = 0; i < jobIds.length; i += 100) {
    const rows = list(await db().from("transfer_items").select("drive_file_id, md5")
      .in("job_id", jobIds.slice(i, i + 100)).not("media_item_id", "is", null));
    album.push(...rows.map((r: { drive_file_id: string; md5: string | null }) => ({ driveFileId: r.drive_file_id, md5: r.md5 })));
  }
  const anywhere = new Set<string>();
  for (let i = 0; i < fileIds.length; i += 100) {
    const rows = list(await db().from("transfer_items").select("drive_file_id")
      .in("drive_file_id", fileIds.slice(i, i + 100)).not("media_item_id", "is", null));
    rows.forEach((r: { drive_file_id: string }) => anywhere.add(r.drive_file_id));
  }
  return { album, anywhere };
}

async function runningJob(folderId: string): Promise<TransferJob | null> {
  return check(await db().from("transfer_jobs").select("*").eq("drive_folder_id", folderId).eq("status", "running").maybeSingle());
}

export async function startTransfer(operator: Operator, folderId: unknown, rawTitle: unknown): Promise<TransferJob> {
  const folder = await requireManagedFolder(folderId);
  const existing = await runningJob(folder.id);
  if (existing) return existing;

  const title = rawTitle === undefined || rawTitle === null ? folder.name : await renameManagedFolder(folder.id, rawTitle);
  const media = await listMedia(folder.id);
  if (!media.length) throw new HttpError(400, "This folder has no photos or videos to transfer.");

  const album = await findOrCreateAlbum(folder.id, title);
  const ledger = await uploadedLedger(album.id, media.map((m) => m.id));

  const { data: job, error } = await db().from("transfer_jobs").insert({
    drive_folder_id: folder.id,
    folder_name: title,
    album_title: title,
    album_id: album.id,
    operator_email: operator.email,
    items_total: media.length,
  }).select("*").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return (await runningJob(folder.id))!;
    throw error;
  }

  const rows = media.map((m) => ({
    job_id: job.id,
    drive_file_id: m.id,
    name: m.name,
    mime_type: m.mimeType,
    size: m.size,
    md5: m.md5 ?? null,
    duplicate: ledger.anywhere.has(m.id) || isDuplicate(m, ledger.album),
  }));
  for (let i = 0; i < rows.length; i += 500) check(await db().from("transfer_items").insert(rows.slice(i, i + 500)));
  return job;
}

async function claimNextItem(jobId: string): Promise<TransferItem | null> {
  const candidates: TransferItem[] = list(await db().from("transfer_items").select("*")
    .eq("job_id", jobId).in("status", activeStatuses).or(unlocked()).order("created_at").limit(5));
  for (const candidate of candidates) {
    const claimed = list(await db().from("transfer_items").update({ locked_until: lease() })
      .eq("id", candidate.id).or(unlocked()).select("*"));
    if (claimed.length) return claimed[0];
  }
  return null;
}

async function saveItem(id: string, patch: Partial<TransferItem> & { error?: string | null; locked_until?: string | null }) {
  check(await db().from("transfer_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id));
}

async function logRow(job: TransferJob, item: TransferItem, result: string) {
  try {
    await appendItemRow(job, { ...item, result });
  } catch (err) {
    console.error("transfer log append failed", err);
  }
}

/**
 * Advances one item by at most one upload chunk, then adds it to the album and trashes it in Drive.
 * Returns true when the item reached a final state.
 */
async function advanceItem(job: TransferJob, item: TransferItem): Promise<boolean> {
  if (item.status === "pending" && item.duplicate) {
    await trashFile(item.drive_file_id);
    await saveItem(item.id, { status: "skipped", locked_until: null });
    await logRow(job, item, "Already in album · removed from Drive");
    return true;
  }

  if (item.status === "pending" || item.status === "uploading") {
    if (item.size <= 0) throw new Error("The file is empty.");
    if (item.upload_url) {
      const state = await photos.queryUpload(item.upload_url);
      if (!state || state.status === "final") {
        item.upload_url = null;
      } else {
        item.bytes_sent = state.received;
      }
    }
    if (!item.upload_url) {
      item.upload_url = await photos.startUpload(item.mime_type, item.size);
      item.bytes_sent = 0;
      await saveItem(item.id, { status: "uploading", upload_url: item.upload_url, bytes_sent: 0, error: null });
    }

    const chunk = nextChunk(item.bytes_sent, item.size, config.chunkBytes);
    const bytes = await downloadRange(item.drive_file_id, chunk.offset, chunk.end);
    const uploadToken = await photos.uploadChunk(item.upload_url, chunk.offset, bytes, chunk.final);
    item.bytes_sent = chunk.end;
    if (!chunk.final || !uploadToken) {
      item.status = "uploading";
      await saveItem(item.id, { status: "uploading", bytes_sent: item.bytes_sent, locked_until: null });
      return false;
    }

    item.media_item_id = await photos.addToAlbum(job.album_id, uploadToken, item.name);
    item.status = "uploaded";
    await saveItem(item.id, { status: "uploaded", bytes_sent: item.size, media_item_id: item.media_item_id, upload_url: null });
  }

  if (item.status === "uploaded") {
    await trashFile(item.drive_file_id);
    await saveItem(item.id, { status: "trashed", locked_until: null });
    await logRow(job, item, "Transferred · removed from Drive");
    const now = new Date().toISOString();
    check(await db().from("photo_albums").update({ last_transfer_at: now }).eq("album_id", job.album_id));
  }
  return true;
}

async function refreshCounts(jobId: string): Promise<TransferJob> {
  const items: { status: string }[] = list(await db().from("transfer_items").select("status").eq("job_id", jobId));
  const count = (s: string) => items.filter((i) => i.status === s).length;
  return one(await db().from("transfer_jobs").update({
    items_total: items.length,
    items_done: count("trashed"),
    items_skipped: count("skipped"),
    items_failed: count("failed"),
  }).eq("id", jobId).select("*").single());
}

async function lastTransferredItem(jobId: string): Promise<{ name: string; at: string } | undefined> {
  const row = check(await db().from("transfer_items").select("name, updated_at")
    .eq("job_id", jobId).eq("status", "trashed").order("updated_at", { ascending: false }).limit(1).maybeSingle());
  return row ? { name: row.name, at: row.updated_at } : undefined;
}

export interface StepResult {
  job: TransferJob;
  current?: { name: string; bytesSent: number; size: number; status: string; error?: string };
  busy?: boolean;
}

export async function stepTransfer(jobId: unknown): Promise<StepResult> {
  if (typeof jobId !== "string") throw new HttpError(400, "Unknown job.");
  const job: TransferJob | null = check(await db().from("transfer_jobs").select("*").eq("id", jobId).maybeSingle());
  if (!job) throw new HttpError(404, "Unknown job.");
  if (job.status !== "running") return { job };

  const item = await claimNextItem(job.id);
  if (!item) {
    const remaining = list(await db().from("transfer_items").select("id").eq("job_id", job.id).in("status", activeStatuses));
    if (remaining.length) return { job: await refreshCounts(job.id), busy: true };
    return { job: await finishJob(job.id, "completed") };
  }

  let error: string | undefined;
  try {
    await advanceItem(job, item);
  } catch (err) {
    if (err instanceof HttpError) {
      // Setup problem (e.g. Google access revoked), not a problem with this file: leave it pending.
      await saveItem(item.id, { locked_until: null });
      throw err;
    }
    error = err instanceof Error ? err.message : String(err);
    item.status = "failed";
    await saveItem(item.id, { status: "failed", error, locked_until: null });
    await logRow(job, item, `Failed · ${error}`);
  }
  const updated = await refreshCounts(job.id);
  try {
    await writeSummary(updated, await lastTransferredItem(job.id));
  } catch (err) {
    console.error("transfer log summary failed", err);
  }
  return {
    job: updated,
    current: { name: item.name, bytesSent: item.bytes_sent, size: item.size, status: item.status, error },
  };
}

async function finishJob(jobId: string, status: "completed" | "cancelled"): Promise<TransferJob> {
  check(await db().from("transfer_jobs").update({ status, finished_at: new Date().toISOString() })
    .eq("id", jobId).eq("status", "running"));
  const job = await refreshCounts(jobId);
  try {
    await writeSummary(job, await lastTransferredItem(jobId));
  } catch (err) {
    console.error("transfer log summary failed", err);
  }
  return job;
}

export async function cancelTransfer(jobId: unknown): Promise<TransferJob> {
  if (typeof jobId !== "string") throw new HttpError(400, "Unknown job.");
  return await finishJob(jobId, "cancelled");
}
