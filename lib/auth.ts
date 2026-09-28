"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export const allowedDomain = "activezoneoutdoor.cy";

/** Supabase session limited to Active Zone Outdoor Google Workspace accounts. */
export function useStaffSession() {
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
        window.setTimeout(() => { void supabase.auth.signOut({ scope: "local" }); }, 0);
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

  /**
   * Signs out of this browser. supabase-js keeps the session when its logout request fails,
   * so on an error or a slow response the stored session is cleared directly.
   */
  async function signOut() {
    const timeout = new Promise<{ error: Error }>((resolve) => window.setTimeout(() => resolve({ error: new Error("Sign-out timed out") }), 4000));
    const result = supabase
      ? await Promise.race([supabase.auth.signOut({ scope: "local" }), timeout]).catch((error: Error) => ({ error }))
      : { error: null };
    if (result.error) clearStoredSession();
    setSession(null);
    window.location.replace(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`);
  }

  return { supabase, session, checking, notice, signIn, signOut };
}

function clearStoredSession() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (/^sb-.+-auth-token/.test(key)) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: there is no stored session to clear.
  }
}
