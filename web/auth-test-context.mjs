// Auth fixture for local analysis regression tests; cloud auth policies are tested separately.
export async function authenticatedAnalysis(context) {
 await context.addInitScript(()=>{sessionStorage.setItem('cloud-session:https://dtrusgylbpulpycjwhrt.supabase.co:autoreport','analysis-test-refresh');});
 await context.route('https://dtrusgylbpulpycjwhrt.supabase.co/auth/v1/**',route=>{
  const user={id:'analysis-regression-user',email:'analysis@example.test',email_confirmed_at:'2026-10-24T00:00:00Z'};
  return route.fulfill({json:route.request().url().includes('/token')?{access_token:'analysis-test-access',refresh_token:'analysis-test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user}:user});
 });
 await context.route('https://dtrusgylbpulpycjwhrt.supabase.co/rest/v1/autoreport_workspaces*',route=>route.fulfill({json:[]}));
}
