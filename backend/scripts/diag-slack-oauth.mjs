// Diagnostics: why is the Slack OAuth exchange failing?
// Run with: node scripts/diag-slack-oauth.mjs
// Prints Slack's real error + the exact authorize URL to open.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// .env lives in backend/.env; this script is in backend/scripts/
const envText = readFileSync(join(here, '..', '.env'), 'utf8');
const vars = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [line.slice(0, i).trim(), v];
    }),
);

const id = vars.SLACK_CLIENT_ID ?? '';
const sec = vars.SLACK_CLIENT_SECRET ?? '';

console.log('--- credential shape (no secret values printed) ---');
console.log('SLACK_CLIENT_ID present:', id !== '', 'id head:', id.slice(0, 8), 'len', id.length);
console.log('SLACK_CLIENT_SECRET present:', sec !== '', 'len', sec.length, 'head:', sec.slice(0, 4));

// 1. Does the secret validate against Slack? Probe with a bogus code — Slack
//    validates client credentials FIRST, so the returned error tells us.
try {
  const r = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: 'probe',
      client_id: id,
      client_secret: sec,
      redirect_uri: vars.SLACK_REDIRECT_URI ?? 'http://localhost:4000/api/auth/slack/callback',
    }),
  });
  const j = await r.json();
  console.log('\n--- oauth.v2.access probe ---');
  console.log('http', r.status, '| ok', j.ok, '| error', j.error, '|', j.description ?? '');
} catch (e) {
  console.log('\nprobe error:', e.message);
}

// 2. The exact authorize URL the "Connect Slack" button should open.
const authorize =
  `https://slack.com/oauth/v2/authorize?` +
  new URLSearchParams({
    client_id: id,
    redirect_uri: vars.SLACK_REDIRECT_URI ?? 'http://localhost:4000/api/auth/slack/callback',
    response_type: 'code',
    scope: 'chat:write,chat:write.public,channels:read,groups:read',
  }).toString();
console.log('\n--- connect this URL (after fixing the secret) ---');
console.log(authorize);

// 3. Fetch the app's live config from Slack (auth.api.test + apps.manifest) to
//    see whether our redirect_uri is registered, and the app's distribution status.
try {
  const at = await fetch('https://slack.com/api/auth.api.test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: '', client_id: id, client_secret: sec }),
  });
  const atj = await at.json();
  console.log('\n--- auth.api.test (client credentials) ---');
  console.log('ok', atj.ok, atj.error ?? '', 'app_id', atj.app_id, 'is_enterprise_install', atj.is_enterprise_install);

  // apps.manifest.get shows the registered redirect URLs for this app.
  const cfg = await fetch('https://slack.com/api/apps.manifest.get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ team_id: atj.team_id, token: 'xapp-' }),
  });
  const cfgj = await cfg.json();
  if (cfgj.ok && cfgj.manifest) {
    const rl = cfgj.manifest.oauth_config?.redirect_urls ?? [];
    const ourUri = vars.SLACK_REDIRECT_URI ?? 'http://localhost:4000/api/auth/slack/callback';
    console.log('\n--- registered redirect URLs ---');
    for (const u of rl) console.log(' ', u);
    console.log('our SLACK_REDIRECT_URI registered?', rl.includes(ourUri), `(${ourUri})`);
    console.log('distribution mode:', cfgj.manifest.distribution_mode);
  } else {
    console.log('\napps.manifest.get:', cfgj.error ?? 'ok (no manifest)');
  }
} catch (e) {
  console.log('\nconfig fetch error:', e.message);
}
