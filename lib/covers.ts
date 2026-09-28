import type { SupabaseClient } from "@supabase/supabase-js";
import { driveThumbnail, type AzoEvent } from "@/lib/events";

const BUCKET = "event-covers";
const MAX_SIDE = 1920;

/** Scales a photo down to at most 1920px on its longest side and re-encodes it as JPEG. */
export async function resizeImage(file: File, maxSide = MAX_SIDE): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't read that image. Please choose a JPEG or PNG photo.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not prepare the photo.")),
    "image/jpeg",
    0.85,
  ));
}

/** Uploads a staff-chosen event photo (already resized); it replaces any previous photo or album cover. */
export async function uploadEventCover(supabase: SupabaseClient, event: Pick<AzoEvent, "id" | "cover_image_path">, blob: Blob): Promise<string> {
  // A new name each time, so browsers and the CDN never show a cached older photo.
  const path = `${event.id}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw error;

  const { error: updateError } = await supabase.from("events").update({ cover_image_path: path, cover_media_id: null }).eq("id", event.id);
  if (updateError) throw updateError;

  if (event.cover_image_path) await supabase.storage.from(BUCKET).remove([event.cover_image_path]);
  return path;
}

/** Removes the uploaded event photo. With `albumMediaId`, the album photo becomes the event photo instead. */
export async function clearEventCover(
  supabase: SupabaseClient,
  event: Pick<AzoEvent, "id" | "cover_image_path">,
  albumMediaId: string | null = null,
): Promise<void> {
  const { error } = await supabase.from("events").update({ cover_image_path: null, cover_media_id: albumMediaId }).eq("id", event.id);
  if (error) throw error;
  if (event.cover_image_path) await supabase.storage.from(BUCKET).remove([event.cover_image_path]);
}

/** The event photo: the uploaded one, else the chosen album photo, else none. */
export function eventCoverUrl(
  supabase: SupabaseClient,
  event: Pick<AzoEvent, "cover_image_path">,
  coverDriveFileId?: string | null,
  width = 1200,
): string | null {
  if (event.cover_image_path) return supabase.storage.from(BUCKET).getPublicUrl(event.cover_image_path).data.publicUrl;
  return coverDriveFileId ? driveThumbnail(coverDriveFileId, width) : null;
}
