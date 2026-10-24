# AutoReport anonymous cloud version

This is a separate public Vercel site. The regular AutoReport site keeps verified email sign-in. The anonymous site creates a Supabase anonymous Auth user in each browser and stores that user's backup in the existing private bucket under the same row and object-level RLS policies. Upload and restore remain manual.

Anonymous identity is tied to the browser's local storage. Clearing site data, browser storage eviction, or switching devices loses the refresh token; Supabase cannot recover that identity or its cloud backup. Users must download a local backup before changing browsers or clearing data. The anonymous version deliberately does not show a logout action.

Before deployment, enable **Supabase Dashboard → Authentication → Sign In / Providers → Anonymous Sign-Ins** for the AutoReport project. Do not make the Storage bucket public or grant the `anon` database role access. Supabase anonymous sessions use the `authenticated` role after sign-in and continue to be limited by the existing `auth.uid()` RLS policies. Configure Supabase CAPTCHA / rate limits before sharing broadly: a public anonymous sign-in endpoint can be abused to create many accounts and consume project storage.

The separate Vercel project `auto-report-no-email` uses the same `meng049-cmd/AutoReport` repository on `main`, with Framework **Other**, Install Command `npm ci --include=dev`, Build Command `bash scripts/build-no-email.sh`, Output Directory `dist`, and Node 24.x. The script prepares a prebuilt copy as well for manual deployment. Do not replace the existing `auto-report` project.
