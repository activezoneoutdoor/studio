function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? fallback;
  if (!value) throw new Error(`Missing required secret ${name}`);
  return value;
}

export const allowedDomain = "activezoneoutdoor.cy";

export const config = {
  get googleClientId() { return env("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return env("GOOGLE_CLIENT_SECRET"); },
  get driveRootFolderId() { return env("DRIVE_ROOT_FOLDER_ID", "1Y1OgT8bnbp4FBadUJH4erIrLGfVVldVN"); },
  get photosAccountEmail() { return env("PHOTOS_ACCOUNT_EMAIL", "photos@activezoneoutdoor.cy").toLowerCase(); },
  get appUrl() { return env("APP_URL", "https://studio.activezoneoutdoor.cy/"); },
  get supabaseUrl() { return env("SUPABASE_URL"); },
  get serviceRoleKey() { return env("SUPABASE_SERVICE_ROLE_KEY"); },
  get stateSecret() { return env("OAUTH_STATE_SECRET"); },
  // Bytes sent to Google Photos per transfer-step call. Kept a multiple of 256 KiB.
  get chunkBytes() {
    const unit = 256 * 1024;
    const requested = Number(env("CHUNK_BYTES", String(32 * 1024 * 1024)));
    return Math.max(unit, Math.floor(requested / unit) * unit);
  },
};

export const googleScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/photoslibrary.appendonly",
  "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata",
  // Needed to rename an album when its Drive folder is renamed.
  "https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata",
];
