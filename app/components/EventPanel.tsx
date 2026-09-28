"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clearEventCover, eventCoverUrl } from "@/lib/covers";
import {
  callFunction, coverMediaJoin, driveFolderUrl, driveThumbnail, eventPageUrl, formatEventDate, isVideo, uploadLinkUrl,
  type AzoEvent, type Media, type MediaStatus,
} from "@/lib/events";

type UploadLink = { token: string; open: boolean; expires_at: string | null };

type Props = {
  supabase: SupabaseClient;
  event: AzoEvent;
  onEdit: () => void;
  onChanged: (event: AzoEvent) => void;
};

const filters: { key: MediaStatus | "all"; label: string }[] = [
  { key: "pending", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "hidden", label: "Hidden" },
  { key: "all", label: "All" },
];

export function EventPanel({ supabase, event, onEdit, onChanged }: Props) {
  const [link, setLink] = useState<UploadLink | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [filter, setFilter] = useState<MediaStatus | "all">("pending");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [linkResult, mediaResult] = await Promise.all([
      supabase.from("event_upload_links").select("token, open, expires_at").eq("event_id", event.id).maybeSingle(),
      supabase.from("media").select("*").eq("event_id", event.id).order("sort_order").order("created_at"),
    ]);
    setLink(linkResult.data);
    setMedia((mediaResult.data ?? []) as Media[]);
  }, [supabase, event.id]);

  useEffect(() => { void load(); }, [load]);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setMessage("");
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  const refreshEvent = async () => {
    const { data } = await supabase.from("events").select(`*, ${coverMediaJoin}`).eq("id", event.id).single();
    if (data) onChanged(data as AzoEvent);
  };

  /** Re-syncs Drive sharing so a published album only exposes approved files. */
  const syncPublishedAlbum = () => callFunction(supabase, "album-publish", { eventId: event.id, publish: true });

  const setStatus = (ids: string[], status: MediaStatus) => run("status", async () => {
    const { error } = await supabase.from("media").update({ status }).in("id", ids);
    if (error) throw error;
    setMedia((items) => items.map((item) => ids.includes(item.id) ? { ...item, status } : item));
    if (event.album_status === "published") await syncPublishedAlbum();
  });

  // Using an album photo replaces any uploaded event photo.
  const setCover = (id: string) => run("cover", async () => {
    await clearEventCover(supabase, event, id);
    await refreshEvent();
  });

  const togglePublish = () => run("publish", async () => {
    const publish = event.album_status !== "published";
    await callFunction(supabase, "album-publish", { eventId: event.id, publish });
    await refreshEvent();
    setMessage(publish ? "Album published." : "Album taken down.");
  });

  const rotateLink = () => run("link", async () => {
    if (!window.confirm("Create a new upload link? The current link will stop working.")) return;
    const { error } = await supabase.rpc("rotate_upload_link", { p_event_id: event.id });
    if (error) throw error;
    await load();
  });

  const toggleLink = () => run("link", async () => {
    const { error } = await supabase.from("event_upload_links").update({ open: !link?.open }).eq("event_id", event.id);
    if (error) throw error;
    await load();
  });

  const copyLink = () => run("copy", async () => {
    if (!link) return;
    await navigator.clipboard.writeText(uploadLinkUrl(link.token));
    setMessage("Upload link copied. Share it in the group chat.");
  });

  const counts = {
    pending: media.filter((m) => m.status === "pending").length,
    approved: media.filter((m) => m.status === "approved").length,
    hidden: media.filter((m) => m.status === "hidden").length,
    all: media.length,
  };
  const visible = filter === "all" ? media : media.filter((m) => m.status === filter);
  const pendingIds = media.filter((m) => m.status === "pending").map((m) => m.id);

  const coverUrl = eventCoverUrl(supabase, event, event.cover?.drive_file_id, 1200);

  return (
    <section className="event-panel">
      {coverUrl
        ? <img className="panel-cover" src={coverUrl} alt="" referrerPolicy="no-referrer" />
        : <button className="panel-cover empty" onClick={onEdit}>+ Add an event photo</button>}
      <div className="panel-head">
        <div>
          <p className="eyebrow">{event.activity.toUpperCase()} · {event.status.toUpperCase()}</p>
          <h2>{event.title}</h2>
          <p className="event-meta">{formatEventDate(event)} · {event.location_name}</p>
          <p className="event-meta">
            {event.leader_name && <>Led by {event.leader_name}</>}
            {event.partners.length > 0 && <> · with {event.partners.join(", ")}</>}
            {event.max_participants && <> · max {event.max_participants} people</>}
          </p>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={onEdit}>Edit details</button>
          <button className="ghost-button" disabled={!!busy} onClick={() => run("refresh", async () => { await Promise.all([load(), refreshEvent()]); })}>Refresh</button>
          {event.status !== "draft" && <a className="ghost-button" href={eventPageUrl(event.slug)} target="_blank" rel="noreferrer">Public page ↗</a>}
        </div>
      </div>

      <div className="upload-link-card">
        <div>
          <p className="eyebrow">PARTICIPANT UPLOAD LINK</p>
          {link ? (
            <>
              <code className="link-text">{uploadLinkUrl(link.token)}</code>
              <p className="form-hint">{link.open ? "Anyone with this link can add photos and videos. No sign-in needed." : "Closed: the link no longer accepts uploads."}</p>
            </>
          ) : <p className="form-hint">Loading…</p>}
        </div>
        <div className="link-actions">
          <button className="primary-button" onClick={copyLink} disabled={!link?.open || !!busy}>Copy link</button>
          <button className="ghost-button" onClick={toggleLink} disabled={!link || !!busy}>{link?.open ? "Close uploads" : "Reopen uploads"}</button>
          <button className="ghost-button" onClick={rotateLink} disabled={!link || !!busy}>New link</button>
          {event.drive_folder_id && <a className="ghost-button" href={driveFolderUrl(event.drive_folder_id)} target="_blank" rel="noreferrer">Drive folder ↗</a>}
        </div>
      </div>

      <div className="section-heading album-heading">
        <div><p className="eyebrow">ALBUM · {event.album_status.toUpperCase()}</p><h2>Review media</h2></div>
        <div className="panel-actions">
          {pendingIds.length > 0 && <button className="ghost-button" disabled={!!busy} onClick={() => setStatus(pendingIds, "approved")}>Approve all {pendingIds.length}</button>}
          <button className="primary-button" disabled={!!busy || (event.album_status !== "published" && counts.approved === 0)} onClick={togglePublish}>
            {busy === "publish" ? "Working…" : event.album_status === "published" ? "Unpublish album" : "Publish album"}
          </button>
        </div>
      </div>
      {event.album_status !== "published" && event.status === "draft" && counts.approved > 0 && <p className="form-hint">The album will be visible once the event is published too.</p>}
      {message && <p className="panel-message" role="status">{message}</p>}

      <div className="filter-tabs" role="tablist">
        {filters.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? "active" : ""} onClick={() => setFilter(f.key)}>
            {f.label} <span>{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="empty-state">{media.length === 0 ? "No uploads yet. Share the upload link with participants after the activity." : "Nothing here."}</p>
      ) : (
        <div className="media-grid">
          {visible.map((item) => (
            <figure key={item.id} className={`media-tile status-${item.status}`}>
              <a href={`https://drive.google.com/file/d/${item.drive_file_id}/view`} target="_blank" rel="noreferrer" className="media-thumb">
                <img src={driveThumbnail(item.drive_file_id, 480)} alt={item.name} loading="lazy" referrerPolicy="no-referrer" />
                {isVideo(item) && <span className="video-badge">▶ VIDEO</span>}
                {event.cover_media_id === item.id && <span className="cover-badge">EVENT PHOTO</span>}
              </a>
              <figcaption>
                <span className="media-name" title={item.name}>{item.uploader_name ?? "Anonymous"}</span>
                <span className="media-actions">
                  {item.status !== "approved" && <button disabled={!!busy} onClick={() => setStatus([item.id], "approved")}>Approve</button>}
                  {item.status !== "hidden" && <button disabled={!!busy} onClick={() => setStatus([item.id], "hidden")}>Hide</button>}
                  {item.status === "approved" && !isVideo(item) && event.cover_media_id !== item.id && <button disabled={!!busy} onClick={() => setCover(item.id)} title="Use as event photo">Event photo</button>}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
