# AZO Studio | Active Zone Outdoor

AZO Studio publishes activity folders from Google Drive as Google Photos albums. Operators sign in with an `@activezoneoutdoor.cy` Google Workspace account and choose a year. The shared Drive folder holds year folders (`2026`, `2025`, …), and each year folder holds one folder per activity. The app shows the activity folders of the selected year in one of three lists:

- **Pending**: the folder has photos or videos waiting to be published.
- **Upcoming**: a new activity folder with no media and no album yet.
- **Done**: no media left, and its album exists.

For a pending folder the operator can edit its name (this renames the Drive folder, and the album if one exists) or transfer it. A transfer runs as `photos@activezoneoutdoor.cy`. It finds or creates the Google Photos album with the folder's name and uploads only files that are not already in that album. Each file moves to the Drive trash once it is in Google Photos. Every item is logged in the **AZO Studio transfer log** Google Sheet. Its *Summary* tab shows the last job and the last item transferred, and its *Items* tab has one row per file.

The static app is hosted on GitHub Pages. Supabase Auth handles sign-in, and Supabase Edge Functions (`supabase/functions`) do the Google work, so the photos@ account's token never reaches the browser.

## Supabase setup

1. Create a Supabase project and enable Google under **Authentication → Providers**. Create a Google OAuth web client and put its client ID and secret in Supabase's provider settings. Do not put the Google client secret or a Supabase service-role key in this repository.
2. Add Supabase's Google callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`) to the Google OAuth client's authorized redirect URIs.
3. In Supabase **Authentication → URL Configuration**, set the site URL and allow these redirect URLs:
   - `http://localhost:3000/`
   - `https://studio.activezoneoutdoor.cy/`
4. Copy `.env.example` to `.env.local` for local development and fill in the Supabase project URL and publishable/anon key. These browser values are public by design; never use a service-role key here.

5. Run `supabase/migrations/20260927000000_restrict_workspace_signups.sql` in the Supabase SQL Editor. Then enable **Authentication → Hooks → Before User Created** and select `public.enforce_azo_workspace_signup`. This hook rejects account creation unless the account is a Google identity with the approved domain.

### Activity folder names

Activity folders are named `<date> <Name>`:

- The date is `YYYYMMDD`, `YYYYMMDD-DD`, `YYYYMMDD-MMDD` or `YYYYMMDD-YYYYMMDD`. It must be a real date and fall in the year folder's year.
- The date is followed by a single space, never `-`.
- The name is CamelCase words: each starts with a capital letter and contains only letters and digits. After the first word, `the`, `in`, `at` and `&` are also allowed.

Examples: `20260315 Troodos Hike`, `20260315-16 Troodos Hike`, `20261230-20270102 NewYear Trip`.

Folders that break these rules are flagged with **Check name** and the list of problems. **A new transfer is blocked until the name is fixed**; the server enforces this too. A transfer that is already running can still be resumed. **Edit name** shows live feedback while the operator types.

### Who can run transfers

Every workspace operator can view folders and rename them. Only accounts in the `TRANSFER_EMAILS` secret can start, resume or stop transfers. This is a comma-separated list, and it defaults to `achernar@activezoneoutdoor.cy`. The server enforces it.

## Google Drive → Photos transfer setup

### Limits to know

- **Google Photos only shows albums this app created.** Since March 2025, the Photos Library API cannot list or add to albums made by hand in the Photos app. An album made by hand with the same name is not reused; AZO Studio creates its own album.
- **The Drive folder must be in a Shared Drive**, and `photos@activezoneoutdoor.cy` needs the **Content manager** role there. In My Drive only a file's owner can trash it, so files uploaded by other people could not be removed.
- Unsupported files (for example PSD or SVG) are skipped. Files that fail stay in Drive and show as failed in the log.

### Google Cloud

1. In the Google Cloud project that has the OAuth client, enable **Google Drive API**, **Photos Library API** and **Google Sheets API**.
2. Set the OAuth consent screen's user type to **Internal**. Workspace-internal apps can use the Drive and Photos scopes without Google verification.
3. Add `https://<project-ref>.supabase.co/functions/v1/google-oauth` to the OAuth client's **Authorized redirect URIs**. You can reuse the client Supabase uses for sign-in or create a separate one.

### Supabase

```bash
supabase link --project-ref <project-ref>
supabase db push          # applies supabase/migrations (transfer tables and policies)
supabase secrets set \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  OAUTH_STATE_SECRET=$(openssl rand -hex 32) \
  APP_URL=https://studio.activezoneoutdoor.cy/ \
  DRIVE_ROOT_FOLDER_ID=1Y1OgT8bnbp4FBadUJH4erIrLGfVVldVN \
  PHOTOS_ACCOUNT_EMAIL=photos@activezoneoutdoor.cy
supabase functions deploy studio-api
supabase functions deploy google-oauth --no-verify-jwt
```

Optional secrets:
- `LOG_SPREADSHEET_ID` uses an existing Sheet instead of creating one in the Drive folder. The Sheet needs *Summary* and *Items* tabs.
- `CHUNK_BYTES` sets the upload chunk size. The default is 32 MB.

**Troubleshooting:** the app may show *"Could not reach the AZO Studio server (Edge Function studio-api)"*. If so, the browser cannot reach the function. Check the following:

1. Run `supabase functions deploy studio-api` and `supabase functions deploy google-oauth --no-verify-jwt` against the same project as `NEXT_PUBLIC_SUPABASE_URL`.
2. Run `supabase secrets list` to confirm the secrets above are set.
3. Look for boot errors under **Dashboard → Edge Functions → studio-api → Logs**.

### Connect the photos account (once)

Google Photos does not support service accounts or domain-wide delegation, so the photos account must approve access once. Operators and developers do not need the photos@ password. Only the person doing this one-time step does, for example a Workspace admin, who can also reset the photos@ password.

Sign in to AZO Studio and click **Connect**. On the Google screen, choose `photos@activezoneoutdoor.cy` and allow every permission. The callback only accepts that account. Its refresh token is stored in the `google_connection` table, which only the service role can read. Use **Reconnect** if access is ever revoked.

### How a transfer runs

Edge Functions have short time limits, so the browser drives the job one step at a time. Each `transfer-step` call handles one file, or one 32 MB chunk of a large video, using a resumable Google Photos upload. Progress is stored in `transfer_jobs` / `transfer_items`. If the tab closes, the folder shows **Resume** and continues where it stopped. Files already published are recognised by Drive file id or MD5 checksum and are not uploaded again.

Unit tests for the rules: `deno test supabase/functions/_shared`.

## Run locally

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project. Leave `NEXT_PUBLIC_BASE_PATH` empty for local development.
2. In Supabase **Authentication → URL Configuration**, add `http://localhost:3000/` to the allowed redirect URLs.
3. From the repository folder, run `npm install`, then `npm run dev`.
4. Open [http://localhost:3000](http://localhost:3000) and sign in with an `@activezoneoutdoor.cy` Google Workspace account.

The app requests Google with `hd=activezoneoutdoor.cy` to guide account selection, then checks the returned account email before showing AZO Studio. Supabase Auth's Before User Created hook enforces the domain for new accounts. Before storing album metadata or publishing controls, apply Row Level Security policies to those records. Photos themselves remain in Google Drive and Google Photos.

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` builds and deploys this repository to `https://studio.activezoneoutdoor.cy/` whenever a change is pushed to `main`.

1. **Finish Supabase setup first.** In the Supabase project, enable Google sign-in, apply the workspace signup migration and hook above, and set the production Site URL to `https://studio.activezoneoutdoor.cy/`.
2. **Allow the app redirect in Supabase.** Under **Authentication → URL Configuration → Redirect URLs**, add `https://studio.activezoneoutdoor.cy/` (keep `http://localhost:3000/` there too if you run locally).
3. **Add the public Supabase browser settings to GitHub.** Open the repository on GitHub, then go to **Settings → Secrets and variables → Actions → Variables → New repository variable**. Add both:
   - Name: `NEXT_PUBLIC_SUPABASE_URL` · Value: the Supabase project's URL.
   - Name: `NEXT_PUBLIC_SUPABASE_ANON_KEY` · Value: the project's publishable key (or legacy anon key).

   These two values are included in the public website bundle, so they are not secrets. Keep the Google OAuth client secret in Supabase's Google provider settings. Never put a Supabase service-role key in GitHub variables or the app.
4. **Enable Pages deployment.** In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
5. **Commit and push to `main`.** Make sure the commit includes `package-lock.json` and `.github/workflows/pages.yml`. Pushing to `main` starts the deploy automatically.
6. **Check the result.** In the repository, open **Actions**, select the latest **Deploy to GitHub Pages** run, and wait for both build and deploy jobs to finish successfully. The site will be at [https://studio.activezoneoutdoor.cy/](https://studio.activezoneoutdoor.cy/).

The workflow uses the custom domain's root path; no `/studio` URL prefix or manual build upload is needed.
