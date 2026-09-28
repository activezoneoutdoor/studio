"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventCoverUrl } from "@/lib/covers";
import { coverMediaJoin, formatEventDate, type AzoEvent } from "@/lib/events";
import { EventForm } from "./EventForm";
import { EventPanel } from "./EventPanel";

type Mode = { kind: "view" } | { kind: "new" } | { kind: "edit"; event: AzoEvent };

export function Dashboard({ supabase }: { supabase: SupabaseClient }) {
  const [events, setEvents] = useState<AzoEvent[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [eventResult, mediaResult] = await Promise.all([
      supabase.from("events").select(`*, ${coverMediaJoin}`).order("starts_at", { ascending: false }),
      supabase.from("media").select("event_id").eq("status", "pending"),
    ]);
    if (eventResult.error) {
      setError(eventResult.error.message);
      return;
    }
    setEvents(eventResult.data as AzoEvent[]);
    const counts: Record<string, number> = {};
    for (const row of mediaResult.data ?? []) counts[row.event_id] = (counts[row.event_id] ?? 0) + 1;
    setPending(counts);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isUpcoming = (e: AzoEvent) => new Date(e.ends_at ?? e.starts_at) >= startOfToday;
  const upcoming = events.filter(isUpcoming).reverse();
  const past = events.filter((e) => !isUpcoming(e));
  const list = tab === "upcoming" ? upcoming : past;
  const selected = events.find((e) => e.id === selectedId) ?? null;

  const replaceEvent = (next: AzoEvent) => {
    setEvents((items) => items.some((e) => e.id === next.id) ? items.map((e) => e.id === next.id ? next : e) : [next, ...items]);
  };

  return (
    <section className="album-section dashboard">
      <div className="section-heading">
        <div><p className="eyebrow">EVENTS & ALBUMS</p><h2>Your activities</h2></div>
        <button className="primary-button" onClick={() => { setMode({ kind: "new" }); setSelectedId(null); }}>+ New event</button>
      </div>
      {error && <p className="auth-notice" role="alert">{error}</p>}

      <div className="dashboard-grid">
        <aside className="event-list">
          <div className="filter-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "upcoming"} className={tab === "upcoming" ? "active" : ""} onClick={() => setTab("upcoming")}>Upcoming <span>{upcoming.length}</span></button>
            <button role="tab" aria-selected={tab === "past"} className={tab === "past" ? "active" : ""} onClick={() => setTab("past")}>Past <span>{past.length}</span></button>
          </div>
          {list.length === 0 && <p className="empty-state">{tab === "upcoming" ? "No upcoming events. Create one to get an upload link." : "No past events yet."}</p>}
          {list.map((e) => (
            <button key={e.id} className={`event-row${e.id === selectedId ? " selected" : ""}`} onClick={() => { setSelectedId(e.id); setMode({ kind: "view" }); }}>
              <EventThumb url={eventCoverUrl(supabase, e, e.cover?.drive_file_id, 160)} />
              <span className="event-row-body">
                <span className="event-row-top"><b>{e.title}</b>{pending[e.id] ? <span className="pill attention">{pending[e.id]} to review</span> : null}</span>
                <span className="event-meta">{formatEventDate(e)} · {e.location_name}</span>
                <span className="event-row-tags">
                  <span className="pill">{e.activity}</span>
                  <span className={`pill status-${e.status}`}>{e.status}</span>
                  {e.album_status === "published" && <span className="pill status-published">album live</span>}
                </span>
              </span>
            </button>
          ))}
        </aside>

        <div className="dashboard-main">
          {mode.kind !== "view" ? (
            <EventForm
              key={mode.kind === "edit" ? mode.event.id : "new"}
              supabase={supabase}
              event={mode.kind === "edit" ? mode.event : null}
              onCancel={() => setMode({ kind: "view" })}
              onSaved={(saved, warning) => { replaceEvent(saved); setSelectedId(saved.id); setMode({ kind: "view" }); setError(warning ?? ""); }}
            />
          ) : selected ? (
            <EventPanel
              key={selected.id}
              supabase={supabase}
              event={selected}
              onEdit={() => setMode({ kind: "edit", event: selected })}
              onChanged={(next) => { replaceEvent(next); void load(); }}
            />
          ) : (
            <div className="empty-panel">
              <p className="eyebrow">HOW IT WORKS</p>
              <ol>
                <li><b>Create the event</b>: date, place, leader, partners, capacity.</li>
                <li><b>Share its upload link</b> with participants. No account needed; files go straight to the event&apos;s Google Drive folder.</li>
                <li><b>Review and publish</b>: approve the best shots and publish the album on the public event page.</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function EventThumb({ url }: { url: string | null }) {
  return <span className="event-thumb">{url && <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />}</span>;
}
