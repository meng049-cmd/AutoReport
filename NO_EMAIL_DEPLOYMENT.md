# AutoReport anonymous cloud version

The AutoReport Vercel production build uses anonymous cloud mode by default. Analysis opens immediately. Set `AUTOREPORT_ANONYMOUS_CLOUD=0` in a Vercel environment to build the verified-email variant. When a user chooses to enable cloud backup, the anonymous site creates a Supabase anonymous Auth user in that browser and stores that user's backup in the existing private bucket under the same row and object-level RLS policies. Upload and restore remain manual.

Anonymous identity is tied to the browser's local storage. Clearing site data, browser storage eviction, or switching devices loses the refresh token; Supabase cannot recover that identity or its cloud backup. Users must download a local backup before changing browsers or clearing data. The anonymous version deliberately does not show a logout action.

Before deployment, enable **Supabase Dashboard → Authentication → Sign In / Providers → Anonymous Sign-Ins** for the AutoReport project. Do not make the Storage bucket public or grant the `anon` database role access. Supabase anonymous sessions use the `authenticated` role after sign-in and continue to be limited by the existing `auth.uid()` RLS policies. Configure Supabase CAPTCHA / rate limits before sharing broadly: a public anonymous sign-in endpoint can be abused to create many accounts and consume project storage.

Vercel production tracks `main`. Run `bash scripts/build-vercel.sh` with output directory `dist`. If email accounts already have cloud backups, download them using the email version before switching. Anonymous identities cannot access backups stored under those accounts.
