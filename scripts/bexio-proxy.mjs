#!/usr/bin/env node
// Local proxy between Z9nAI Hours and the bexio API.
//
// bexio only allows browser calls from office.bexio.com (CORS), so the app
// talks to this proxy on localhost instead. The proxy adds the API token, which
// therefore never lives in the browser or in the (git-committed) data folder.
//
// Token: environment variable BEXIO_TOKEN, or the file
//        ~/.config/z9nai-hours/bexio-token (first line).
// Start: npm run bexio-proxy        (port: BEXIO_PROXY_PORT, default 8787)

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.BEXIO_PROXY_PORT || 8787);
const API = process.env.BEXIO_API_URL || 'https://api.bexio.com'; // override only for testing
const TOKEN_FILE = join(homedir(), '.config', 'z9nai-hours', 'bexio-token');
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
  ['POST', /^\/3\.0\/accounting\/manual_entries$/],
  ['POST', /^\/3\.0\/accounting\/manual_entries\/\d+\/files$/],
  ['POST', /^\/3\.0\/accounting\/manual_entries\/\d+\/entries\/\d+\/files$/],
];

function token() {
  if (process.env.BEXIO_TOKEN) return process.env.BEXIO_TOKEN.trim();
  try { return readFileSync(TOKEN_FILE, 'utf8').split('\n')[0].trim(); } catch { return ''; }
}

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

  const url = req.url || '/';
  if (url === '/health') return send(res, 200, { ok: true, tokenConfigured: !!token() });
  if (!url.startsWith('/bexio/')) return send(res, 404, { error: 'Unbekannter Pfad' });

  const path = url.slice('/bexio'.length);
  if (!ALLOWED.some(([m, re]) => m === req.method && re.test(path))) {
    return send(res, 403, { error: `${req.method} ${path} ist nicht freigegeben` });
  }
  const t = token();
  if (!t) return send(res, 500, { error: `Kein bexio-Token (BEXIO_TOKEN oder ${TOKEN_FILE})` });

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
  console.log(`bexio-Proxy läuft auf http://localhost:${PORT}  (Token: ${token() ? 'gefunden' : 'FEHLT'})`);
});
