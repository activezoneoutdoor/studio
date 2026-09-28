import { config, googleScopes } from "./config.ts";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(config.stateSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

export function callbackUrl(): string {
  return `${config.supabaseUrl}/functions/v1/google-oauth`;
}

/** Signed, short-lived state naming the operator who started the connection. */
export async function signState(operatorEmail: string): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify({ by: operatorEmail, exp: Date.now() + 10 * 60_000 })));
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyState(state: string | null): Promise<{ by: string } | null> {
  const [payload, signature] = (state ?? "").split(".");
  if (!payload || !signature || signature !== await hmac(payload)) return null;
  const data = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
  return typeof data.exp === "number" && data.exp > Date.now() ? { by: String(data.by) } : null;
}

export async function consentUrl(operatorEmail: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: googleScopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: config.photosAccountEmail,
    hd: config.photosAccountEmail.split("@")[1],
    state: await signState(operatorEmail),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Reads the email claim of an id_token received directly from Google's token endpoint over TLS. */
export function idTokenEmail(idToken: string): string {
  const payload = JSON.parse(new TextDecoder().decode(fromBase64url(idToken.split(".")[1] ?? "")));
  return payload.email_verified ? String(payload.email).toLowerCase() : "";
}
