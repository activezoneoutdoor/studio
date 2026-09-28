"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { folderNameIssues } from "@/supabase/functions/_shared/folderName";
import { studioApi, type Folder, type FolderStatus, type StepResult, type StudioStatus, type YearFolder } from "@/lib/studioApi";

const tabs: { key: FolderStatus; label: string; empty: string }[] = [
  { key: "pending", label: "Pending", empty: "No folders are waiting to be published." },
  { key: "upcoming", label: "Upcoming", empty: "No new activity folders waiting for uploads." },
  { key: "done", label: "Done", empty: "No folders have been published yet." },
];

interface Progress {
  folderId: string;
  jobId: string;
  result?: StepResult;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function FolderBoard({ supabase }: { supabase: SupabaseClient }) {
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [tab, setTab] = useState<FolderStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string; saving?: boolean } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [years, setYears] = useState<YearFolder[] | null>(null);
  const [yearId, setYearId] = useState<string | null>(null);
  const selectedYear = useRef<string | null>(null);
  const stopRequested = useRef(false);

  const load = useCallback(async (nextYearId?: string) => {
    setLoading(true);
    try {
      const nextStatus = await studioApi.status(supabase);
      setStatus(nextStatus);
      if (!nextStatus.connected) return;
      const { years: yearList } = await studioApi.years(supabase);
      setYears(yearList);
      const currentYear = String(new Date().getFullYear());
      const chosen = yearList.find((y) => y.id === (nextYearId ?? selectedYear.current))
        ?? yearList.find((y) => y.name === currentYear)
        ?? yearList[0];
      selectedYear.current = chosen?.id ?? null;
      setYearId(selectedYear.current);
      setFolders(chosen ? (await studioApi.folders(supabase, chosen.id)).folders : []);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const yearName = years?.find((y) => y.id === yearId)?.name;

  function chooseYear(id: string) {
    if (id === yearId) return;
    setFolders(null);
    setEditing(null);
    setConfirming(null);
    void load(id);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    if (google) {
      setNotice(google === "connected" ? "Google Photos account connected." : params.get("reason") ?? "Could not connect Google.");
      window.history.replaceState(null, "", window.location.pathname);
    }
    void load();
  }, [load]);

  async function connect() {
    try {
      window.location.href = (await studioApi.connectUrl(supabase)).url;
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  async function saveName(folder: Folder) {
    if (!editing) return;
    setEditing({ ...editing, saving: true });
    try {
      const { name } = await studioApi.rename(supabase, folder.id, editing.value);
      setFolders((list) => list?.map((f) => f.id === folder.id
        ? { ...f, name, nameIssues: folderNameIssues(name, yearName), album: f.album && { ...f.album, title: name } }
        : f) ?? null);
      setEditing(null);
      setNotice(`Renamed to “${name}”.`);
    } catch (err) {
      setNotice((err as Error).message);
      setEditing({ ...editing, saving: false });
    }
  }

  async function runJob(folderId: string, jobId: string) {
    stopRequested.current = false;
    setProgress({ folderId, jobId });
    try {
      for (;;) {
        if (stopRequested.current) {
          const { job } = await studioApi.cancel(supabase, jobId);
          setNotice(`Transfer stopped. ${job.items_done} item(s) were published.`);
          break;
        }
        const result = await studioApi.step(supabase, jobId);
        setProgress({ folderId, jobId, result });
        if (result.job.status !== "running") {
          const { job } = result;
          setNotice(`“${job.album_title}”: ${job.items_done} published, ${job.items_skipped} already in the album, ${job.items_failed} failed.`);
          break;
        }
        if (result.busy) await wait(2000);
      }
    } catch (err) {
      setNotice(`${(err as Error).message} The transfer is paused — use Resume to continue.`);
    } finally {
      setProgress(null);
      await load();
    }
  }

  async function startTransfer(folder: Folder) {
    setConfirming(null);
    setProgress({ folderId: folder.id, jobId: "" });
    let jobId: string;
    try {
      jobId = (await studioApi.startTransfer(supabase, folder.id, folder.name)).job.id;
    } catch (err) {
      setNotice((err as Error).message);
      setProgress(null);
      return;
    }
    await runJob(folder.id, jobId);
  }

  const counts = Object.fromEntries(tabs.map((t) => [t.key, folders?.filter((f) => f.status === t.key).length ?? 0]));
  const visible = folders?.filter((f) => f.status === tab) ?? [];
  const busy = !!progress;
  const flagged = folders?.filter((f) => f.nameIssues.length).length ?? 0;

  return (
    <section className="album-section">
      <div className="section-heading">
        <div><p className="eyebrow">ALBUM WORKFLOW</p><h2>Drive folders → Google Photos</h2></div>
        <button className="text-button" onClick={() => void load()} disabled={loading || busy}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      <p className="source-intro">
        Each activity folder inside a year folder (2026, 2025…) of the <a href={status?.rootFolderUrl} target="_blank" rel="noreferrer">shared Drive folder</a> becomes a Google Photos album
        in <strong>{status?.expectedEmail ?? "photos@activezoneoutdoor.cy"}</strong>. Transferred files move to the Drive trash
        {status?.logSheetUrl ? <> and are recorded in the <a href={status.logSheetUrl} target="_blank" rel="noreferrer">transfer log</a></> : null}.
      </p>

      {notice && <p className="board-notice" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></p>}

      {status && !status.connected && (
        <div className="public-gallery-note">
          <span className="gallery-dot warn"></span>
          <div><p className="eyebrow">GOOGLE PHOTOS</p><strong>Connect {status.expectedEmail}</strong><p>One-time setup: someone who can sign in as {status.expectedEmail} (for example a Workspace admin) clicks Connect and approves access. After that every operator can publish without the photos account password.</p></div>
          <button className="primary-button" onClick={connect}>Connect</button>
        </div>
      )}

      {status?.connected && (
        <>
          <div className="board-meta">
            <span><span className="gallery-dot"></span> Publishing as <strong>{status.accountEmail}</strong> · <button className="link-button" onClick={connect}>Reconnect</button></span>
            {status.lastJob && <span>Last transfer: <strong>{status.lastJob.album_title}</strong> · {formatDate(status.lastJob.finished_at ?? status.lastJob.started_at)} · {status.lastJob.items_done} item(s)</span>}
          </div>

          {years && (years.length ? (
            <div className="year-chips" role="group" aria-label="Year">
              {years.map((y) => (
                <button key={y.id} className={y.id === yearId ? "year-chip active" : "year-chip"} aria-pressed={y.id === yearId}
                  disabled={busy || loading} onClick={() => chooseYear(y.id)}>{y.name}</button>
              ))}
            </div>
          ) : <p className="board-empty">No year folders (like “2026”) found in the shared Drive folder yet.</p>)}

          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "tab active" : "tab"} onClick={() => setTab(t.key)}>
                {t.label}<span>{counts[t.key]}</span>
              </button>
            ))}
          </div>

          {!status.canTransfer && <p className="board-hint">Transfers are limited to approved accounts for now. You can still review folders and fix names.</p>}
          {flagged > 0 && <p className="board-hint warn">{flagged} folder{flagged === 1 ? "" : "s"} in {yearName} {flagged === 1 ? "does" : "do"} not follow the naming convention <code>YYYYMMDD[-DD|-MMDD|-YYYYMMDD] CamelCaseName</code>.</p>}

          {!folders && loading && <p className="board-empty">Reading the Drive folder…</p>}
          {folders && !visible.length && <p className="board-empty">{tabs.find((t) => t.key === tab)?.empty}</p>}

          <ul className="folder-list">
            {visible.map((folder) => {
              const isEditing = editing?.id === folder.id;
              const running = progress?.folderId === folder.id ? progress : null;
              const job = running?.result?.job;
              const current = running?.result?.current;
              const handled = job ? job.items_done + job.items_skipped + job.items_failed : 0;
              return (
                <li key={folder.id} className={folder.nameIssues.length ? "folder-row flagged" : "folder-row"}>
                  <div className="folder-main">
                    {isEditing ? (
                      <form className="rename-form" onSubmit={(e) => { e.preventDefault(); void saveName(folder); }}>
                        <input autoFocus value={editing.value} maxLength={500} aria-label="Folder name"
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })} disabled={editing.saving} />
                        <button className="primary-button" disabled={editing.saving || !editing.value.trim()}>Save</button>
                        <button type="button" className="text-button" onClick={() => setEditing(null)} disabled={editing.saving}>Cancel</button>
                        <NameIssues issues={folderNameIssues(editing.value, yearName)} okText="Name follows the convention." />
                      </form>
                    ) : (
                      <>
                        <h3>
                          <a href={folder.url} target="_blank" rel="noreferrer">{folder.name}</a>
                          {folder.nameIssues.length > 0 && <span className="name-flag" title={folder.nameIssues.join("\n")}>Check name</span>}
                        </h3>
                        <NameIssues issues={folder.nameIssues} />
                      </>
                    )}
                    <p>
                      {folder.status === "pending" && `${folder.mediaCount} photo${folder.mediaCount === 1 ? "" : "s"}/video${folder.mediaCount === 1 ? "" : "s"} to publish`}
                      {folder.status === "upcoming" && "Waiting for uploads"}
                      {folder.status === "done" && `Published${folder.album?.lastTransferAt ? ` ${formatDate(folder.album.lastTransferAt)}` : ""}`}
                      {folder.album && <> · album {folder.album.url
                        ? <a href={folder.album.url} target="_blank" rel="noreferrer">{folder.album.title}</a>
                        : folder.album.title}{folder.status === "pending" && " (new items will be added)"}</>}
                    </p>
                    {running && (
                      <div className="progress" aria-live="polite">
                        <div className="progress-bar"><span style={{ width: `${job?.items_total ? (handled / job.items_total) * 100 : 2}%` }}></span></div>
                        <small>
                          {job ? `${handled} of ${job.items_total}` : "Preparing album…"}
                          {current && current.status === "uploading" && ` · ${current.name} ${formatBytes(current.bytesSent)} / ${formatBytes(current.size)}`}
                          {current?.error && ` · ${current.name} failed: ${current.error}`}
                        </small>
                      </div>
                    )}
                    {confirming === folder.id && (
                      <div className="confirm">
                        <p>Publish {folder.mediaCount} item(s) to the album <strong>“{folder.name}”</strong> as {status.accountEmail}? Each file moves to the Drive trash once it is in Google Photos.</p>
                        <button className="primary-button" onClick={() => void startTransfer(folder)}>Transfer</button>
                        <button className="text-button" onClick={() => setConfirming(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                  <div className="folder-actions">
                    {running ? (
                      <button className="text-button" onClick={() => { stopRequested.current = true; }}>Stop</button>
                    ) : !isEditing && confirming !== folder.id && (
                      <>
                        {(folder.status !== "done" || folder.nameIssues.length > 0) && (
                          <button className="text-button" disabled={busy} onClick={() => setEditing({ id: folder.id, value: folder.name })}>Edit name</button>
                        )}
                        {folder.status === "pending" && status.canTransfer && (folder.runningJob
                          ? <button className="primary-button" disabled={busy} onClick={() => void runJob(folder.id, folder.runningJob!.id)}>Resume</button>
                          : <button className="primary-button" disabled={busy} onClick={() => setConfirming(folder.id)}>Transfer</button>)}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function NameIssues({ issues, okText }: { issues: string[]; okText?: string }) {
  if (!issues.length) return okText ? <p className="name-ok">{okText}</p> : null;
  return <ul className="name-issues">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>;
}
