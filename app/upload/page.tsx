"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { formatEventDate } from "@/lib/events";
import { mediaType, uploadToEvent } from "@/lib/upload";
import { PublicShell } from "../components/Shell";

type LinkEvent = { title: string; activity: string; starts_at: string; location_name: string; accepting: boolean };
type Item = { id: number; file: File; progress: number; state: "queued" | "uploading" | "done" | "error"; error?: string };

const PARALLEL_UPLOADS = 3;

export default function UploadPage() {
  const supabase = getSupabaseBrowserClient();
  const [token, setToken] = useState("");
  const [event, setEvent] = useState<LinkEvent | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "invalid">("loading");
  const [name, setName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const nextId = useRef(0);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    try { setName(localStorage.getItem("azo-uploader-name") ?? ""); } catch { /* storage unavailable */ }
    if (!supabase || !t) {
      setStatus("invalid");
      return;
    }
    void supabase.rpc("upload_link_event", { p_token: t }).then(({ data }) => {
      const row = (data as LinkEvent[] | null)?.[0];
      setEvent(row ?? null);
      setStatus(row ? "ready" : "invalid");
    });
  }, [supabase]);

  const update = (id: number, patch: Partial<Item>) => setItems((list) => list.map((i) => i.id === id ? { ...i, ...patch } : i));

  function addFiles(files: FileList | null) {
    const accepted = Array.from(files ?? []).filter((f) => /^(image|video)\//.test(mediaType(f)));
    setItems((list) => [...list, ...accepted.map((file) => ({ id: nextId.current++, file, progress: 0, state: "queued" as const }))]);
  }

  async function uploadAll() {
    if (!supabase) return;
    try { localStorage.setItem("azo-uploader-name", name.trim()); } catch { /* storage unavailable */ }
    setRunning(true);
    const queue = items.filter((i) => i.state === "queued" || i.state === "error");
    const upload = async (item: Item) => {
      update(item.id, { state: "uploading", progress: 0, error: undefined });
      try {
        await uploadToEvent(supabase, token, item.file, name.trim(), (progress) => update(item.id, { progress }));
        update(item.id, { state: "done", progress: 1 });
      } catch (error) {
        update(item.id, { state: "error", error: error instanceof Error ? error.message : "Upload failed" });
      }
    };
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await upload(item);
    };

    // The first upload creates the event's Drive folder, so it runs alone before the parallel ones.
    const first = queue.shift();
    if (first) await upload(first);
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker));
    setRunning(false);
  }

  const done = items.filter((i) => i.state === "done").length;
  const waiting = items.filter((i) => i.state === "queued" || i.state === "error").length;

  return (
    <PublicShell>
      <section className="upload-page">
        {status === "loading" && <p className="empty-state">Checking your upload link…</p>}
        {status === "invalid" && (
          <div className="empty-panel"><p className="eyebrow">UPLOAD LINK</p><h1>This link isn&apos;t valid.</h1><p>Ask your activity leader for the current upload link.</p></div>
        )}
        {status === "ready" && event && (
          <>
            <p className="eyebrow">SHARE YOUR PHOTOS & VIDEOS · {event.activity.toUpperCase()}</p>
            <h1>{event.title}</h1>
            <p className="event-meta">{formatEventDate({ starts_at: event.starts_at, ends_at: null })} · {event.location_name}</p>

            {!event.accepting ? (
              <p className="auth-notice">Uploads for this event are closed.</p>
            ) : (
              <div className="upload-card">
                <label><span>Your name <small>optional, shown with your photos</small></span>
                  <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Maria" disabled={running} />
                </label>
                <label className="drop-zone">
                  <input type="file" accept="image/*,video/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} disabled={running} />
                  <b>Choose photos and videos</b>
                  <span>Originals are kept in full quality. Videos up to 2 GB each.</span>
                </label>

                {items.length > 0 && (
                  <ul className="upload-list">
                    {items.map((item) => (
                      <li key={item.id} className={`upload-item ${item.state}`}>
                        <span className="upload-name">{item.file.name}</span>
                        <span className="upload-state">
                          {item.state === "done" ? "✓ Uploaded" : item.state === "error" ? item.error : item.state === "uploading" ? `${Math.round(item.progress * 100)}%` : `${(item.file.size / 1024 ** 2).toFixed(1)} MB`}
                        </span>
                        <span className="progress"><span style={{ width: `${item.progress * 100}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                )}

                <button className="primary-button wide" disabled={running || waiting === 0} onClick={uploadAll}>
                  {running ? `Uploading… ${done}/${items.length}` : waiting ? `Upload ${waiting} file${waiting === 1 ? "" : "s"}` : done ? "All uploaded. Thank you!" : "Upload"}
                </button>
                {running && <p className="form-hint">Keep this page open until uploads finish.</p>}
              </div>
            )}
          </>
        )}
      </section>
    </PublicShell>
  );
}
