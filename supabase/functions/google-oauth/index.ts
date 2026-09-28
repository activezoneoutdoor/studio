// OAuth callback for connecting the photos@ Google account. Deployed with --no-verify-jwt because
// Google redirects the browser here without a Supabase session; the signed `state` authorises it.

import { config, googleScopes } from "../_shared/config.ts";
import { adminClient } from "../_shared/db.ts";
import { callbackUrl, idTokenEmail, verifyState } from "../_shared/oauth.ts";

function backToApp(result: "connected" | "error", reason?: string): Response {
  const url = new URL(config.appUrl);
  url.searchParams.set("google", result);
  if (reason) url.searchParams.set("reason", reason);
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  try {
    const state = await verifyState(params.get("state"));
    if (!state) return backToApp("error", "The connection link expired. Try again.");
    if (params.get("error")) return backToApp("error", `Google: ${params.get("error")}`);

    const code = params.get("code");
    if (!code) return backToApp("error", "Google did not return an authorisation code.");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: callbackUrl(),
        grant_type: "authorization_code",
      }),
    });
    const token = await res.json();
    if (!res.ok) return backToApp("error", `Google: ${token.error_description ?? token.error}`);

    const email = idTokenEmail(token.id_token ?? "");
    if (email !== config.photosAccountEmail) {
      return backToApp("error", `Sign in as ${config.photosAccountEmail} (you chose ${email || "another account"}).`);
    }
    const granted = String(token.scope ?? "").split(" ");
    const missing = googleScopes.filter((s) => s.startsWith("https://") && !granted.includes(s));
    if (missing.length) return backToApp("error", "Allow every permission on the Google screen so transfers can run.");
    if (!token.refresh_token) return backToApp("error", "Google did not return offline access. Try again.");

    const { error } = await adminClient().from("google_connection").upsert({
      id: true,
      email,
      refresh_token: token.refresh_token,
      scopes: token.scope,
      connected_at: new Date().toISOString(),
    });
    if (error) throw error;
    console.log(`photos account connected by ${state.by}`);
    return backToApp("connected");
  } catch (err) {
    console.error(err);
    return backToApp("error", "Could not save the Google connection.");
  }
});
