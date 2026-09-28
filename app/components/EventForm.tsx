"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clearEventCover, eventCoverUrl, resizeImage, uploadEventCover } from "@/lib/covers";
import { activities, coverMediaJoin, slugify, type AzoEvent, type EventStatus } from "@/lib/events";

type Props = {
  supabase: SupabaseClient;
  event: AzoEvent | null;
  /** `warning` is set when the event saved but its photo change failed. */
  onSaved: (event: AzoEvent, warning?: string) => void;
  onCancel: () => void;
};

/** datetime-local value in the browser's time zone (staff work in Cyprus time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function EventForm({ supabase, event, onSaved, onCancel }: Props) {
  const [form, setForm] = useState({
    title: event?.title ?? "",
    activity: event?.activity ?? "",
    starts_at: toLocalInput(event?.starts_at ?? null),
    ends_at: toLocalInput(event?.ends_at ?? null),
    location_name: event?.location_name ?? "",
    lat: event?.lat?.toString() ?? "",
    lng: event?.lng?.toString() ?? "",
    leader_name: event?.leader_name ?? "",
    leader_email: event?.leader_email ?? "",
    partners: event?.partners.join(", ") ?? "",
    max_participants: event?.max_participants?.toString() ?? "",
    description: event?.description ?? "",
    status: event?.status ?? ("draft" as EventStatus),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);

  const photoUrl = useMemo(() => photo ? URL.createObjectURL(photo) : null, [photo]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  const currentCover = event && !removePhoto ? eventCoverUrl(supabase, event, event.cover?.drive_file_id, 800) : null;
  const preview = photoUrl ?? currentCover;

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    setPreparingPhoto(true);
    try {
      setPhoto(await resizeImage(file));
      setRemovePhoto(false);
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : String(photoError));
    } finally {
      setPreparingPhoto(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const row = {
      title: form.title.trim(),
      activity: form.activity.trim(),
      starts_at: fromLocalInput(form.starts_at),
      ends_at: fromLocalInput(form.ends_at),
      location_name: form.location_name.trim(),
      lat: form.lat ? Number(form.lat) : null,
      lng: form.lng ? Number(form.lng) : null,
      leader_name: form.leader_name.trim() || null,
      leader_email: form.leader_email.trim() || null,
      partners: form.partners.split(",").map((p) => p.trim()).filter(Boolean),
      max_participants: form.max_participants ? Number(form.max_participants) : null,
      description: form.description.trim() || null,
      status: form.status,
    };

    const query = event
      ? supabase.from("events").update(row).eq("id", event.id)
      : supabase.from("events").insert({ ...row, slug: slugify(form.starts_at.slice(0, 10), row.activity, row.location_name) });
    const { data, error: saveError } = await query.select().single();

    if (saveError) {
      setSaving(false);
      setError(saveError.code === "23505" ? "An event with the same date, activity and location already exists." : saveError.message);
      return;
    }

    const saved = data as AzoEvent;
    let warning: string | undefined;
    try {
      if (photo) await uploadEventCover(supabase, saved, photo);
      else if (removePhoto) await clearEventCover(supabase, saved);
    } catch (photoError) {
      warning = `Event saved, but the photo could not be updated: ${photoError instanceof Error ? photoError.message : String(photoError)}. Use Edit details to try again.`;
    }

    const { data: fresh } = await supabase.from("events").select(`*, ${coverMediaJoin}`).eq("id", saved.id).single();
    setSaving(false);
    onSaved((fresh ?? saved) as AzoEvent, warning);
  }

  return (
    <form className="event-form" onSubmit={save}>
      <div className="section-heading"><div><p className="eyebrow">{event ? "EDIT EVENT" : "NEW EVENT"}</p><h2>{event ? event.title : "Plan an activity"}</h2></div></div>
      <div className="form-grid">
        <div className="span-2 photo-field">
          <div className="photo-preview">{preview ? <img src={preview} alt="" referrerPolicy="no-referrer" /> : <span>{form.activity || "Event"}</span>}</div>
          <div className="photo-copy">
            <b>Event photo</b>
            <p className="form-hint">Shown on the events list and the event page. JPEG or PNG; resized automatically. You can also pick an album photo later.</p>
            <div className="form-actions">
              <label className="ghost-button file-button">
                {preparingPhoto ? "Preparing…" : preview ? "Replace photo" : "Choose photo"}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={preparingPhoto} onChange={(e) => { void choosePhoto(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {preview && <button type="button" className="ghost-button" onClick={() => { setPhoto(null); setRemovePhoto(!!currentCover); }}>Remove</button>}
            </div>
          </div>
        </div>
        <label className="span-2">Title<input required maxLength={200} value={form.title} onChange={set("title")} placeholder="Sunrise SUP at Konnos Bay" /></label>
        <label>Activity<input required list="activity-options" value={form.activity} onChange={set("activity")} placeholder="SUP" /></label>
        <datalist id="activity-options">{activities.map((a) => <option key={a} value={a} />)}</datalist>
        <label>Status<select value={form.status} onChange={set("status")}><option value="draft">Draft (staff only)</option><option value="published">Published</option><option value="cancelled">Cancelled</option></select></label>
        <label>Starts<input required type="datetime-local" value={form.starts_at} onChange={set("starts_at")} /></label>
        <label>Ends<input type="datetime-local" value={form.ends_at} min={form.starts_at} onChange={set("ends_at")} /></label>
        <label className="span-2">Location<input required value={form.location_name} onChange={set("location_name")} placeholder="Ayia Napa" /></label>
        <label><span>Latitude <small>optional</small></span><input type="number" step="any" min={-90} max={90} value={form.lat} onChange={set("lat")} /></label>
        <label><span>Longitude <small>optional</small></span><input type="number" step="any" min={-180} max={180} value={form.lng} onChange={set("lng")} /></label>
        <label>Leader<input value={form.leader_name} onChange={set("leader_name")} /></label>
        <label>Leader email<input type="email" value={form.leader_email} onChange={set("leader_email")} /></label>
        <label><span>Together with <small>comma-separated</small></span><input value={form.partners} onChange={set("partners")} placeholder="Cyprus Hiking Club, …" /></label>
        <label>Max participants<input type="number" min={1} value={form.max_participants} onChange={set("max_participants")} /></label>
        <label className="span-2">Description<textarea rows={4} value={form.description} onChange={set("description")} /></label>
      </div>
      {!event && <p className="form-hint">The album folder is named automatically, e.g. <code>2026-09-27_SUP_Ayia-Napa</code>.</p>}
      {error && <p className="auth-notice" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={saving || preparingPhoto}>{saving ? "Saving…" : event ? "Save changes" : "Create event"}</button>
        <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
