"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import FolderBoard from "@/app/components/FolderBoard";

const allowedDomain = "activezoneoutdoor.cy";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState("");
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }

    const acceptSession = (next: Session | null) => {
      if (!next) {
        setSession(null);
        return;
      }

      const email = next.user.email?.trim().toLowerCase() ?? "";
      if (email.endsWith(`@${allowedDomain}`)) {
        setSession(next);
        setNotice("");
      } else {
        setSession(null);
        setNotice(`This studio is limited to @${allowedDomain} accounts.`);
        window.setTimeout(() => { void supabase.auth.signOut(); }, 0);
      }
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setNotice("Could not check your sign-in. Please try again.");
      acceptSession(data.session);
      setChecking(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => acceptSession(next));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  async function signIn() {
    if (!supabase) return;
    setNotice("");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { hd: allowedDomain, prompt: "select_account" } },
    });
    if (error) setNotice(error.message);
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  if (checking) return <main className="loading-shell"><span className="brand-mark">AZO</span><p>Opening AZO Studio…</p></main>;

  if (!session) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark" aria-hidden="true">AZO</div>
          <p className="eyebrow">ACTIVE ZONE OUTDOOR</p>
          <h1>Your albums,<br />thoughtfully curated.</h1>
          <p className="intro">Bring contributor albums from Google Drive and Google Photos together, then choose what appears in the public Active Zone Outdoor gallery.</p>
          <button className="google-button" onClick={signIn} disabled={!supabase}>
            <GoogleMark /> Continue with Google <span aria-hidden="true">→</span>
          </button>
          {!supabase && <p className="config-note">Add your Supabase project URL and publishable key to enable sign-in.</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <p className="access-note"><span className="lock-icon">●</span> Sign in with your Active Zone Outdoor Google Workspace account</p>
          <p className="domain-note">Access is limited to <strong>@{allowedDomain}</strong></p>
        </section>
        <aside className="visual-panel" aria-label="Studio introduction">
          <div className="sun"></div>
          <div className="mountain mountain-back"></div>
          <div className="mountain mountain-front"></div>
          <div className="photo-caption"><span>AZO STUDIO · ALBUM MANAGEMENT</span><b>Stories made to be shared.</b></div>
          <div className="image-credit">ACTIVE ZONE OUTDOOR · CYPRUS</div>
        </aside>
      </main>
    );
  }

  const fullName = session.user.user_metadata.full_name
    ?? session.user.user_metadata.name
    ?? "AZO team member";
  const firstName = fullName.split(" ")[0];
  const avatarUrl = session.user.user_metadata.avatar_url ?? session.user.user_metadata.picture;

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <a className="wordmark" href="./" aria-label="AZO Studio home"><span className="brand-mark small">AZO</span><span>ACTIVE ZONE OUTDOOR <i>AZO STUDIO</i></span></a>
        <div className="account">
          {avatarUrl ? <img className="avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{fullName[0]?.toUpperCase() ?? "A"}</span>}
          <span className="account-details"><span className="account-name" title={fullName}>{fullName}</span><span className="account-email" title={session.user.email ?? undefined}>{session.user.email}</span></span>
          <button className="sign-out" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <section className="welcome">
        <p className="eyebrow">AZO STUDIO · YOUR WORKSPACE</p>
        <h1>Good to have you here{firstName ? `, ${firstName}` : ""}.</h1>
        <p>Publish activity folders from Google Drive as Google Photos albums.</p>
      </section>
      <FolderBoard supabase={supabase!} />
      <footer className="workspace-footer"><span>ACTIVE ZONE OUTDOOR</span><span>MADE FOR THE OUTDOORS <b>↗</b></span></footer>
    </main>
  );
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15Z"/><path fill="#FF3D00" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.7-5.1c-1.8 1.2-4 2-6.8 2-5.2 0-9.6-3.5-11.2-8.2H5.9v5.2A20 20 0 0 0 24 44Z"/><path fill="#4CAF50" d="M12.8 27.9a12 12 0 0 1 0-7.8v-5.2H5.9a20 20 0 0 0 0 18.2l6.9-5.2Z"/><path fill="#1976D2" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.7 29.5 4 24 4A20 20 0 0 0 5.9 14.9l6.9 5.2C14.4 15.4 18.8 11.9 24 11.9Z"/></svg>;
}
