"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { eventCoverUrl } from "@/lib/covers";
import { coverMediaJoin, driveThumbnail, formatEventDate, isVideo, publicEventColumns, type AzoEvent, type Media } from "@/lib/events";
import { PublicShell } from "../components/Shell";
import { Lightbox } from "../components/Lightbox";

export default function EventPage() {
  const supabase = getSupabaseBrowserClient();
  const [event, setEvent] = useState<AzoEvent | null | undefined>(undefined);
  const [media, setMedia] = useState<Media[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (!supabase || !slug) return setEvent(null);

    void (async () => {
      const { data } = await supabase.from("events").select(`${publicEventColumns}, ${coverMediaJoin}`)
        .eq("slug", slug).in("status", ["published", "cancelled"]).maybeSingle();
      const found = data as unknown as AzoEvent | null;
      setEvent(found);
      if (found) document.title = `${found.title} | Active Zone Outdoor`;
      if (found?.album_status === "published") {
        const { data: items } = await supabase.from("media").select("*")
          .eq("event_id", found.id).eq("status", "approved").order("sort_order").order("created_at");
        setMedia((items ?? []) as Media[]);
      }
    })();
  }, [supabase]);

  if (event === undefined) return <PublicShell><p className="empty-state">Loading…</p></PublicShell>;
  if (event === null) {
    return <PublicShell><div className="empty-panel"><p className="eyebrow">EVENT</p><h1>Event not found.</h1><p><a href="../events/">See all events</a></p></div></PublicShell>;
  }

  const mapUrl = event.lat != null && event.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${event.lat},${event.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location_name)}`;

  const coverUrl = supabase ? eventCoverUrl(supabase, event, event.cover?.drive_file_id, 2000) : null;

  return (
    <PublicShell>
      {coverUrl && <img className="event-hero-image" src={coverUrl} alt="" referrerPolicy="no-referrer" />}
      <section className="welcome event-hero">
        <p className="eyebrow">{event.activity.toUpperCase()}{event.status === "cancelled" ? " · CANCELLED" : ""}</p>
        <h1>{event.title}</h1>
        <dl className="event-facts">
          <div><dt>When</dt><dd>{formatEventDate(event)}</dd></div>
          <div><dt>Where</dt><dd><a href={mapUrl} target="_blank" rel="noreferrer">{event.location_name} ↗</a></dd></div>
          {event.leader_name && <div><dt>Leader</dt><dd>{event.leader_name}</dd></div>}
          {event.partners.length > 0 && <div><dt>Together with</dt><dd>{event.partners.join(", ")}</dd></div>}
          {event.max_participants && <div><dt>Group size</dt><dd>Up to {event.max_participants} people</dd></div>}
        </dl>
        {event.description && <p className="event-description">{event.description}</p>}
      </section>

      {event.album_status === "published" && (
        <section className="album-section">
          <div className="section-heading"><div><p className="eyebrow">ALBUM</p><h2>{media.length} photos &amp; videos</h2></div></div>
          <div className="media-grid public">
            {media.map((item, i) => (
              <button key={item.id} className="media-thumb" onClick={() => setOpen(i)} aria-label={`Open ${item.name}`}>
                <img src={driveThumbnail(item.drive_file_id, 800)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                {isVideo(item) && <span className="video-badge">▶</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      {open !== null && media.length > 0 && <Lightbox items={media} index={open} onChange={setOpen} />}
    </PublicShell>
  );
}
