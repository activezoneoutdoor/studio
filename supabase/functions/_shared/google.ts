import { config } from "./config.ts";
import { adminClient } from "./db.ts";
import { HttpError } from "./http.ts";

export interface GoogleConnection {
  email: string;
  refresh_token: string;
  scopes: string;
  log_spreadsheet_id: string | null;
  connected_at: string;
}

export async function getConnection(): Promise<GoogleConnection | null> {
  const { data, error } = await adminClient()
    .from("google_connection")
    .select("email, refresh_token, scopes, log_spreadsheet_id, connected_at")
    .maybeSingle();
  if (error) throw error;
  return data;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value;

  const connection = await getConnection();
  if (!connection) throw new HttpError(409, `Connect the ${config.photosAccountEmail} Google account first.`);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    if (body.error === "invalid_grant") {
      throw new HttpError(409, `Google access for ${config.photosAccountEmail} was revoked or expired. Connect it again.`);
    }
    throw new Error(`Google token refresh failed: ${body.error_description ?? body.error ?? res.status}`);
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Authenticated fetch to a Google API with retries on rate limits and server errors. */
export async function gfetch(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await getAccessToken()}`);
    const res = await fetch(url, { ...init, headers });
    const retryable = res.status === 429 || res.status >= 500;
    if (res.ok || !retryable || attempt >= attempts) {
      if (!res.ok) {
        const text = await res.text();
        let message = text;
        try {
          message = JSON.parse(text).error?.message ?? text;
        } catch { /* not JSON */ }
        throw new GoogleApiError(res.status, `Google API ${res.status}: ${message}`.slice(0, 500));
      }
      return res;
    }
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
}

export async function gjson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await gfetch(url, init);
  return await res.json() as T;
}

export function jsonBody(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
