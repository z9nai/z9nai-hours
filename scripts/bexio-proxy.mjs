#!/usr/bin/env node
// Local proxy between Z9nAI Hours and the bexio API.
//
// bexio only allows browser calls from office.bexio.com (CORS), so the app
// talks to this proxy on localhost instead. The proxy adds the access token,
// which therefore never lives in the browser or in the (git-committed) data folder.
//
// Access, in this order:
//   1. Personal access token: env BEXIO_TOKEN or ~/.config/z9nai-hours/bexio-token
//   2. OAuth with a registered bexio app: client id/secret in
//      ~/.config/z9nai-hours/bexio-oauth.json, connect once via /oauth/start.
//      The refresh token is kept in ~/.config/z9nai-hours/bexio-refresh-token
//      and renewed on every use, so the connection does not expire.
// Start: npm run bexio-proxy        (port: BEXIO_PROXY_PORT, default 8787)

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.BEXIO_PROXY_PORT || 8787);
const API = process.env.BEXIO_API_URL || 'https://api.bexio.com'; // override only for testing
const IDP = process.env.BEXIO_IDP_URL || 'https://auth.bexio.com/realms/bexio/protocol/openid-connect';
const SCOPES = 'openid offline_access accounting file'; // file: attach receipts
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;
const CONFIG_DIR = join(homedir(), '.config', 'z9nai-hours');
const TOKEN_FILE = join(CONFIG_DIR, 'bexio-token');
const OAUTH_FILE = join(CONFIG_DIR, 'bexio-oauth.json');
const REFRESH_FILE = join(CONFIG_DIR, 'bexio-refresh-token');
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://z9nai.github.io',
]);

// Only what the app needs: read accounts/currencies, create entries, attach files
const ALLOWED = [
  ['GET', /^\/2\.0\/accounts(\?.*)?$/],
  ['GET', /^\/3\.0\/currencies(\?.*)?$/],
  ['GET', /^\/3\.0\/accounting\/manual_entries\/next_ref_nr$/],
  ['GET', /^\/3\.0\/accounting\/manual_entries\?limit=\d+(&offset=\d+)?$/],
  ['POST', /^\/3\.0\/accounting\/manual_entries$/],
  ['POST', /^\/3\.0\/accounting\/manual_entries\/\d+\/files$/],
  ['POST', /^\/3\.0\/accounting\/manual_entries\/\d+\/entries\/\d+\/files$/],
];

const readText = f => { try { return readFileSync(f, 'utf8').trim(); } catch { return ''; } };
const writeSecret = (f, text) => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(f, text, { mode: 0o600 });
};

// ── Personal access token ───────────────────────────────────────────────────
function pat() {
  return (process.env.BEXIO_TOKEN || readText(TOKEN_FILE).split('\n')[0] || '').trim();
}

// A JWT's "exp" claim says when it stops working
function jwtExpires(t) {
  try {
    const exp = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp;
    return exp ? new Date(exp * 1000).toISOString() : null;
  } catch { return null; }
}

// ── OAuth ───────────────────────────────────────────────────────────────────
function oauthConfig() {
  try {
    const c = JSON.parse(readFileSync(OAUTH_FILE, 'utf8'));
    return c.clientId && c.clientSecret ? c : null;
  } catch { return null; }
}

let access = null;      // { token, expiresAt }
let refreshing = null;  // in-flight refresh
const pending = new Map(); // state → { verifier, at }

async function tokenRequest(params) {
  const c = oauthConfig();
  if (!c) throw new Error(`Keine OAuth-Konfiguration (${OAUTH_FILE})`);
  const res = await fetch(`${IDP}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: c.clientId, client_secret: c.clientSecret }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`bexio-Anmeldung fehlgeschlagen: ${body.error_description || body.error || res.status}`);
  access = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000, scope: body.scope ?? '' };
  if (body.refresh_token) writeSecret(REFRESH_FILE, body.refresh_token); // rotates on every refresh
  return access.token;
}

async function oauthToken() {
  if (access && access.expiresAt - Date.now() > 60_000) return access.token;
  const refresh = readText(REFRESH_FILE);
  if (!refresh) return '';
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function token() {
  return pat() || oauthToken();
}

function page(res, status, title, text) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:15px -apple-system,sans-serif;max-width:480px;margin:80px auto;color:#111">
<h2>${title}</h2><p>${text}</p></body>`);
}

function startOAuth(res) {
  const c = oauthConfig();
  if (!c) return page(res, 500, 'Nicht eingerichtet', `Client-ID und Secret fehlen in <code>${OAUTH_FILE}</code>.`);
  const state = randomBytes(16).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  pending.set(state, { verifier, at: Date.now() });
  const url = new URL(`${IDP}/auth`);
  url.search = new URLSearchParams({
    client_id: c.clientId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES, state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

async function finishOAuth(res, query) {
  const p = pending.get(query.get('state') ?? '');
  pending.delete(query.get('state') ?? '');
  if (query.get('error')) return page(res, 400, 'Abgebrochen', query.get('error_description') || query.get('error'));
  if (!p || Date.now() - p.at > 10 * 60_000) return page(res, 400, 'Ungültige Anmeldung', 'Bitte in der App erneut auf «Mit bexio verbinden» klicken.');
  try {
    await tokenRequest({ grant_type: 'authorization_code', code: query.get('code') ?? '', redirect_uri: REDIRECT_URI, code_verifier: p.verifier });
    page(res, 200, 'Mit bexio verbunden ✓', 'Du kannst dieses Fenster schliessen und in Z9nAI Hours weiterarbeiten.');
    console.log(`${new Date().toLocaleTimeString('de-CH')}  OAuth verbunden`);
  } catch (e) {
    page(res, 500, 'Anmeldung fehlgeschlagen', e.message);
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (!cors(req, res)) return send(res, 403, { error: `Origin ${req.headers.origin} nicht erlaubt` });
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const u = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (u.pathname === '/oauth/start') return startOAuth(res);
  if (u.pathname === '/oauth/callback') return finishOAuth(res, u.searchParams);
  if (u.pathname === '/health') {
    const p = pat();
    let connected = !!p, error = null;
    if (!p && readText(REFRESH_FILE)) {
      try { connected = !!(await oauthToken()); } catch (e) { error = e.message; }
    }
    return send(res, 200, {
      ok: true,
      mode: p ? 'pat' : oauthConfig() ? 'oauth' : null,
      oauthConfigured: !!oauthConfig(),
      tokenConfigured: connected,
      tokenExpires: p ? jwtExpires(p) : null,
      scopes: !p && access?.scope ? access.scope.split(' ') : undefined,
      error,
    });
  }
  if (!u.pathname.startsWith('/bexio/')) return send(res, 404, { error: 'Unbekannter Pfad' });

  const path = req.url.slice('/bexio'.length);
  if (!ALLOWED.some(([m, re]) => m === req.method && re.test(path))) {
    return send(res, 403, { error: `${req.method} ${path} ist nicht freigegeben` });
  }
  let t;
  try { t = await token(); } catch (e) { return send(res, 401, { error: e.message }); }
  if (!t) return send(res, 401, { error: 'Nicht mit bexio verbunden (Admin → «Mit bexio verbinden»)' });

  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const upstream = await fetch(API + path, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: 'application/json',
        ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
      },
      body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(body);
    console.log(`${new Date().toLocaleTimeString('de-CH')}  ${req.method} ${path} → ${upstream.status}`);
  } catch (e) {
    send(res, 502, { error: `bexio nicht erreichbar: ${e.message}` });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const mode = pat() ? 'Personal Access Token' : oauthConfig() ? (readText(REFRESH_FILE) ? 'OAuth (verbunden)' : 'OAuth (noch nicht verbunden)') : 'kein Zugang eingerichtet';
  console.log(`bexio-Proxy läuft auf http://localhost:${PORT}  (${mode})`);
});
