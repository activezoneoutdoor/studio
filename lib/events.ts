import type { SupabaseClient } from "@supabase/supabase-js";

export type EventStatus = "draft" | "published" | "cancelled";
export type AlbumStatus = "none" | "collecting" | "published";
export type MediaStatus = "pending" | "approved" | "hidden";

export type AzoEvent = {
  id: string;
  slug: string;
  title: string;
  activity: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string;
  lat: number | null;
  lng: number | null;
  leader_name: string | null;
  leader_email: string | null;
  partners: string[];
  max_participants: number | null;
  description: string | null;
  status: EventStatus;
  album_status: AlbumStatus;
  drive_folder_id: string | null;
  cover_media_id: string | null;
  cover_image_path: string | null;
  /** Present when loaded with `coverMediaJoin`. */
  cover?: { drive_file_id: string } | null;
};

export type Media = {
  id: string;
  event_id: string;
  drive_file_id: string;
  name: string;
  mime_type: string;
  size: number | null;
  uploader_name: string | null;
  status: MediaStatus;
  sort_order: number;
  created_at: string;
};

export const activities = ["Hiking", "SUP", "Kayaking", "Cycling", "Snorkeling", "Climbing", "Camping", "Trail running"];

/** Embeds the album photo chosen as the event photo (events.cover_media_id). */
export const coverMediaJoin = "cover:media!events_cover_media_fk(drive_file_id)";

export const publicEventColumns =
  "id, slug, title, activity, starts_at, ends_at, location_name, lat, lng, leader_name, partners, max_participants, description, status, album_status, cover_media_id, cover_image_path";

export function driveThumbnail(fileId: string, width = 800): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;
}

export function drivePreview(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

export function isVideo(media: Pick<Media, "mime_type">): boolean {
  return media.mime_type.startsWith("video/");
}

export function slugify(...parts: string[]): string {
  return parts.join(" ")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Nicosia" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Nicosia" });

export function formatEventDate(event: Pick<AzoEvent, "starts_at" | "ends_at">): string {
  const start = new Date(event.starts_at);
  const text = `${dateFormat.format(start)} · ${timeFormat.format(start)}`;
  if (!event.ends_at) return text;
  const end = new Date(event.ends_at);
  return dateFormat.format(end) === dateFormat.format(start)
    ? `${text}–${timeFormat.format(end)}`
    : `${text} → ${dateFormat.format(end)}`;
}

export function uploadLinkUrl(token: string): string {
  return `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/upload/?t=${encodeURIComponent(token)}`;
}

export function eventPageUrl(slug: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/event/?slug=${encodeURIComponent(slug)}`;
}

/** Calls a Supabase Edge Function and surfaces its `error` message. */
export async function callFunction<T>(supabase: SupabaseClient, name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const detail = context ? await context.json().catch(() => null) : null;
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}
