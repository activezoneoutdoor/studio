// Pure business rules shared by the Edge Functions. No I/O here so they can be unit tested.

import { allowedDomain } from "./config.ts";

export type FolderStatus = "upcoming" | "pending" | "done";

export function isOperatorEmail(email: string | undefined | null): boolean {
  return (email ?? "").trim().toLowerCase().endsWith(`@${allowedDomain}`);
}

const unsupportedImageTypes = new Set(["image/svg+xml", "image/vnd.adobe.photoshop", "image/x-photoshop"]);

/** Photos and videos that Google Photos can take. */
export function isMediaMime(mimeType: string): boolean {
  const type = mimeType.toLowerCase();
  if (type.startsWith("video/")) return true;
  return type.startsWith("image/") && !unsupportedImageTypes.has(type);
}

/**
 * upcoming: nothing uploaded yet and no album — a new activity waiting for photos.
 * pending:  media waiting to be transferred (album may or may not exist yet).
 * done:     no media left and an album exists.
 */
export function classifyFolder(mediaCount: number, hasAlbum: boolean): FolderStatus {
  if (mediaCount > 0) return "pending";
  return hasAlbum ? "done" : "upcoming";
}

/** Returns the cleaned name, or throws with a message for the operator. */
export function validateFolderName(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Enter a name.");
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Enter a name.");
  // Google Photos album titles are limited to 500 characters.
  if (name.length > 500) throw new Error("Names can be at most 500 characters.");
  return name;
}

export interface ChunkPlan {
  offset: number;
  end: number; // exclusive
  final: boolean;
}

/** Next byte range to send for a resumable upload. */
export function nextChunk(bytesSent: number, size: number, chunkBytes: number): ChunkPlan {
  const offset = Math.min(Math.max(bytesSent, 0), size);
  const end = Math.min(offset + chunkBytes, size);
  return { offset, end, final: end >= size };
}

export interface MediaFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  md5?: string;
}

export interface LedgerEntry {
  driveFileId: string;
  md5?: string | null;
}

/** A file is a duplicate if this Drive file, or a file with the same checksum, is already in the album. */
export function isDuplicate(file: MediaFile, albumLedger: LedgerEntry[]): boolean {
  return albumLedger.some((entry) =>
    entry.driveFileId === file.id || (!!file.md5 && !!entry.md5 && entry.md5 === file.md5)
  );
}

/** Items in these states need no more work. */
export const finalItemStatuses = ["trashed", "skipped", "failed"] as const;
