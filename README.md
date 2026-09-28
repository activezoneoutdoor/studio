# AZO Studio | Active Zone Outdoor

AZO Studio lists Active Zone Outdoor events (date, location, leader, partner groups, group size) and collects each event's photos and videos from participants. Staff create an event and share its upload link, for example in the group chat. Participants upload without an account, and the files go straight into an automatically named folder in a Google Workspace Shared Drive, such as `2026/2026-09-27_SUP_Ayia-Napa`. Staff approve or hide uploads and publish the album on the event's public page.

Everything runs on free tiers: the static site on GitHub Pages, data and sign-in on Supabase, and small Supabase Edge Functions that talk to Google Drive. Media never passes through Supabase. It is stored in the Workspace's pooled Drive storage and uploaded from the browser directly to Google.

| Page | Who | Purpose |
| --- | --- | --- |
| `/` | Staff (`@activezoneoutdoor.cy`) | Create/edit events, copy/close/rotate upload links, review media, publish albums |
| `/upload/?t=<token>` | Anyone with the link | Upload photos and videos (up to 2 GB each, resumable) |
| `/events/` | Public | Upcoming events and past albums |
| `/event/?slug=<slug>` | Public | Event details and the published album |

## Supabase setup

1. Create a Supabase project and enable Google under **Authentication → Providers**. Create a Google OAuth web client and put its client ID and secret in Supabase's provider settings. Do not put the Google client secret or a Supabase service-role key in this repository.
2. Add Supabase's Google callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`) to the Google OAuth client's authorized redirect URIs.
3. In Supabase **Authentication → URL Configuration**, set the site URL and allow these redirect URLs:
   - `http://localhost:3000/`
   - `https://studio.activezoneoutdoor.cy/`
4. Copy `.env.example` to `.env.local` for local development and fill in the Supabase project URL and publishable/anon key. These browser values are public by design; never use a service-role key here.

5. Run `supabase/migrations/20260927000000_restrict_workspace_signups.sql` in the Supabase SQL Editor. Then enable **Authentication → Hooks → Before User Created** and select `public.enforce_azo_workspace_signup`. This hook rejects account creation unless the account is a Google identity with the approved domain.
6. Run `supabase/migrations/20260928000000_events_albums.sql` in the SQL Editor (or `supabase db push`). It creates `events`, `event_upload_links` and `media` with Row Level Security. Staff accounts can manage everything. The public can read only published events and the approved media of published albums. Upload tokens are never readable by the public.
7. Run `supabase/migrations/20260929000000_event_cover_images.sql`. It adds event photos: a public Storage bucket `event-covers` that only staff can write to. Staff pick the photo in the event form; it is resized in the browser to at most 1920px (typically 200–500 KB). Alternatively, an approved album photo can be used as the event photo. Whichever was chosen last is shown.

## Google Drive setup (album storage)

1. **Create a Shared Drive** in Google Drive, e.g. "AZO Albums". Open it and copy its ID from the URL (`https://drive.google.com/drive/folders/<shared-drive-id>`).
2. **Create an OAuth client** (no service-account key needed; the organisation policy `iam.disableServiceAccountKeyCreation` can stay on). In [Google Cloud Console](https://console.cloud.google.com/), in the same project as the Supabase sign-in client or a new one:
   - Enable the **Google Drive API**.
   - Under **Google Auth Platform → Audience** (older consoles: **OAuth consent screen**), make sure the user type is **Internal**. Internal apps need no Google verification, and their refresh tokens don't expire after 7 days.
   - Under **Clients → Create client**, choose **Web application**, name it "AZO Drive uploader", and add the authorised redirect URI `https://developers.google.com/oauthplayground`. Copy the client ID and client secret.
3. **Authorise it once with a staff account.** Use a stable account that is a **Content manager** of the Shared Drive.
   - Open [OAuth Playground](https://developers.google.com/oauthplayground). Click ⚙ and tick **Use your own OAuth credentials**, then paste the client ID and secret.
   - In **Step 1**, type the scope `https://www.googleapis.com/auth/drive.file` into the input box and click **Authorize APIs**. Sign in with that staff account.
   - In **Step 2**, click **Exchange authorization code for tokens**, then copy the **Refresh token**.

   `drive.file` limits the app to the folders and files it creates itself; the rest of your Drive stays invisible to it. The files belong to the Shared Drive, not to that account. If the account is later suspended or removes the app's access, uploads fail with an "authorisation expired or was revoked" error. Redo this step with another staff account and update the secret. If the Shared Drive refuses folder creation under `drive.file`, redo this step with the scope `https://www.googleapis.com/auth/drive`. No code change is needed.
4. **Allow public album links.** Published albums share each approved file as "anyone with the link can view", so photos can be shown on the public page. In the Google Admin console, open **Apps → Google Workspace → Drive and Docs → Sharing settings** and allow sharing outside the organisation, at least for the organisational unit that owns the Shared Drive. In the Shared Drive's settings, allow people outside the organisation to access files. Unpublished and hidden uploads stay private.

## Edge Functions

The functions in `supabase/functions/` hold the Google credentials; the browser never sees them.

| Function | Caller | What it does |
| --- | --- | --- |
| `upload-start` | Participant upload page | Checks the upload link, creates the event's Drive folder on first use, and opens a resumable Drive upload session for the browser |
| `upload-finish` | Participant upload page | Confirms the file is in the event folder and records it for review |
| `album-publish` | Staff dashboard | Publishes or unpublishes an album and syncs Drive link sharing, so only approved files are public |

Deploy with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```sh
supabase link --project-ref <project-ref>
supabase secrets set \
  GOOGLE_OAUTH_CLIENT_ID=<client-id> \
  GOOGLE_OAUTH_CLIENT_SECRET=<client-secret> \
  GOOGLE_OAUTH_REFRESH_TOKEN=<refresh-token> \
  AZO_SHARED_DRIVE_ID=<shared-drive-id> \
  ALLOWED_ORIGINS=https://studio.activezoneoutdoor.cy,http://localhost:3000
supabase functions deploy upload-start --no-verify-jwt
supabase functions deploy upload-finish --no-verify-jwt
supabase functions deploy album-publish --no-verify-jwt
```

`--no-verify-jwt` lets anonymous participants call the upload functions; each function checks its own access (upload token or staff session). Keep the client secret and refresh token only in Supabase secrets; never commit them. Run `deno test --allow-env` inside `supabase/functions` for the unit tests.

## Run locally

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project. Leave `NEXT_PUBLIC_BASE_PATH` empty for local development.
2. In Supabase **Authentication → URL Configuration**, add `http://localhost:3000/` to the allowed redirect URLs.
3. From the repository folder, run `npm install`, then `npm run dev`.
4. Open [http://localhost:3000](http://localhost:3000) and sign in with an `@activezoneoutdoor.cy` Google Workspace account.

The app requests Google with `hd=activezoneoutdoor.cy` to guide account selection, then checks the returned account email before showing AZO Studio. Supabase Auth's Before User Created hook enforces the domain for new accounts. The database's Row Level Security policies apply the same domain check to every staff write. Participants never sign in; the upload link token is their only access.

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
