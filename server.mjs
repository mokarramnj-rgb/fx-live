import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

/* Empty APP_PASSWORD disables the gate (local development). */
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_COOKIE = 'fx_session';
const SESSION_TTL = 30 * 24 * 60 * 60; /* seconds */

/* ------------------------------------------------------------------ cnbc */

const INSTRUMENTS = new Set([
  'XAU=', 'BTC=', '@CL.1', 'JPY=',
  'EUR=', 'GBP=', 'AUD=', 'CAD=', 'CHF=',
  'XAG=', 'ETH=', '@LCO.1', '@NG.1', '@SP.1', '@ND.1',
]);

const RANGES = new Set(['1D', '5D']);

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,+%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function timeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref();
  return c.signal;
}

/* ---------------------------------------------------------------- chart */

const chartCache = new Map();

async function fetchChart(symbol, range) {
  if (!INSTRUMENTS.has(symbol)) throw new Error('unknown symbol');
  if (!RANGES.has(range)) throw new Error('unknown range');

  const key = `${symbol}:${range}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.at < 15000) return hit.data;

  const url = `https://ts-api.cnbc.com/harmony/app/charts/${range}.json?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: timeout(8000),
  });
  if (!res.ok) throw new Error(`cnbc chart ${res.status}`);
  const payload = await res.json();
  const raw = payload?.barData?.priceBars || [];

  const bars = [];
  for (const b of raw) {
    const t = Number(b.tradeTimeinMills);
    const o = num(b.open);
    const h = num(b.high);
    const l = num(b.low);
    const c = num(b.close);
    if (!Number.isFinite(t) || o === null || h === null || l === null || c === null) continue;
    if (c <= 0) continue;
    bars.push({ t, o, h, l, c, v: num(b.volume) || 0 });
  }

  const data = { symbol, range, bars };
  chartCache.set(key, { at: Date.now(), data });
  return data;
}

/* ------------------------------------------------------- fxcm live ticks */

/* FXCM publishes a small XML snapshot that ticks every 2–4 seconds, unlike
   CNBC's once-a-minute quote timestamps. It is used for the live price only;
   CNBC still supplies the day's open/high/low/previous-close metadata. */

const FXCM_SYMBOL = {
  'XAU=': 'XAUUSD',
  'XAG=': 'XAGUSD',
  'BTC=': 'BTCUSD',
  'ETH=': 'ETHUSD',
  'JPY=': 'USDJPY',
  'EUR=': 'EURUSD',
  'GBP=': 'GBPUSD',
  'AUD=': 'AUDUSD',
  'CAD=': 'USDCAD',
  'CHF=': 'USDCHF',
  '@CL.1': 'USOil',
  '@LCO.1': 'UKOil',
  '@NG.1': 'NGAS',
  '@SP.1': 'SPX500',
  '@ND.1': 'NAS100',
};

let fxcmCache = { at: 0, data: null };

async function fetchFxcm() {
  if (fxcmCache.data && Date.now() - fxcmCache.at < 800) return fxcmCache.data;

  const res = await fetch('https://rates.fxcm.com/RatesXML', {
    headers: { 'user-agent': UA, accept: 'application/xml,text/xml,*/*' },
    signal: timeout(4000),
  });
  if (!res.ok) throw new Error(`fxcm ${res.status}`);
  const xml = await res.text();

  const out = {};
  for (const m of xml.matchAll(/<Rate Symbol="([^"]+)">([\s\S]*?)<\/Rate>/g)) {
    const symbol = m[1];
    const body = m[2];
    const bid = num((body.match(/<Bid>([^<]+)<\/Bid>/) || [])[1]);
    const askRaw = num((body.match(/<Ask>([^<]+)<\/Ask>/) || [])[1]);
    if (bid === null || bid <= 0) continue;
    const ask = askRaw !== null && askRaw > 0 ? askRaw : bid;
    out[symbol] = {
      bid,
      ask,
      mid: (bid + ask) / 2,
      spread: ask - bid,
      ts: Date.now(),
    };
  }

  if (!Object.keys(out).length) throw new Error('fxcm empty snapshot');
  fxcmCache = { at: Date.now(), data: out };
  return out;
}

/* ---------------------------------------------------------------- quotes */

let quoteCache = { key: '', at: 0, data: null };

/* Last known CNBC day stats per symbol, so live FXCM prices keep working
   through a CNBC hiccup. */
const metaCache = new Map();
let cnbcRowsCache = { key: '', at: 0, data: [] };

async function fetchCnbcRows(symbols) {
  const key = symbols.slice().sort().join(',');
  if (cnbcRowsCache.key === key && Date.now() - cnbcRowsCache.at < 20_000) {
    return cnbcRowsCache.data;
  }

  const url =
    'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol' +
    `?symbols=${encodeURIComponent(symbols.join('|'))}` +
    '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1';

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: timeout(7000),
    });
    if (!res.ok) throw new Error(`cnbc quote ${res.status}`);
    const payload = await res.json();
    const rows = [].concat(payload?.FormattedQuoteResult?.FormattedQuote || []);
    cnbcRowsCache = { key, at: Date.now(), data: rows };
    return rows;
  } catch (err) {
    if (cnbcRowsCache.key === key && Date.now() - cnbcRowsCache.at < 120_000) {
      return cnbcRowsCache.data;
    }
    throw err;
  }
}

async function fetchQuotes(symbols) {
  const clean = [...new Set(symbols)].filter((s) => INSTRUMENTS.has(s));
  if (!clean.length) throw new Error('no valid symbols');

  const key = clean.slice().sort().join(',');
  if (quoteCache.key === key && Date.now() - quoteCache.at < 800) return quoteCache.data;

  const [cnbcResult, fxcmResult] = await Promise.allSettled([
    fetchCnbcRows(clean),
    fetchFxcm(),
  ]);

  if (cnbcResult.status === 'fulfilled') {
    for (const q of cnbcResult.value) {
      const price = num(q.last);
      if (price === null) continue;
      const parsed = Date.parse(q.last_time);
      metaCache.set(q.symbol, {
        name: q.name,
        price,
        open: num(q.open),
        high: num(q.high),
        low: num(q.low),
        prevClose: num(q.previous_day_closing),
        volume: num(q.volume),
        changePct: num(q.change_pct),
        ts: Number.isFinite(parsed) ? parsed : Date.now(),
        realTime: q.realTime === 'true',
      });
    }
  }

  const fx = fxcmResult.status === 'fulfilled' ? fxcmResult.value : null;

  if (!metaCache.size && !fx) {
    throw new Error('no quote sources available');
  }

  const now = Date.now();
  const quotes = [];

  for (const symbol of clean) {
    const meta = metaCache.get(symbol);
    const tick = fx && FXCM_SYMBOL[symbol] ? fx[FXCM_SYMBOL[symbol]] : null;

    let price;
    let ts;
    let realTime;
    if (tick) {
      price = tick.mid;
      ts = now;
      realTime = true;
    } else if (meta) {
      price = meta.price;
      ts = meta.ts;
      realTime = meta.realTime;
    } else {
      continue;
    }

    const prevClose = meta?.prevClose ?? null;
    const change = prevClose ? price - prevClose : null;
    const changePct = prevClose
      ? (change / prevClose) * 100
      : meta?.changePct ?? null;

    let high = meta?.high ?? null;
    let low = meta?.low ?? null;
    if (high !== null && price > high) high = price;
    if (low !== null && price < low) low = price;

    quotes.push({
      symbol,
      name: meta?.name ?? symbol,
      price,
      bid: tick?.bid ?? null,
      ask: tick?.ask ?? null,
      spread: tick?.spread ?? null,
      change,
      changePct,
      open: meta?.open ?? null,
      high,
      low,
      prevClose,
      volume: meta?.volume ?? null,
      ts,
      realTime,
      live: Boolean(tick),
    });
  }

  quoteCache = { key, at: now, data: quotes };
  return quotes;
}

/* ------------------------------------------------------------ static + SSE */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const clients = new Set();

function broadcastReload() {
  for (const res of clients) res.write('data: reload\n\n');
}

const json = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

/* ------------------------------------------------------------------ auth */

const loginAttempts = new Map();
const ATTEMPT_WINDOW = 15 * 60_000;
const MAX_ATTEMPTS = 8;

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();

function signExpiry(exp) {
  return crypto.createHmac('sha256', APP_PASSWORD).update(String(exp)).digest('hex');
}

function newSessionToken() {
  const exp = Date.now() + SESSION_TTL * 1000;
  return `${exp}.${signExpiry(exp)}`;
}

function sessionValid(token) {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;

  const got = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(signExpiry(exp));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  return sessionValid(cookieValue(req, SESSION_COOKIE));
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || Boolean(req.socket.encrypted);
}

function sessionCookie(req, token, maxAge = SESSION_TTL) {
  const secure = isHttps(req) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function ipOf(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function attemptAllowed(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.first > ATTEMPT_WINDOW) return true;
  return rec.count < MAX_ATTEMPTS;
}

function noteFailure(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.first > ATTEMPT_WINDOW) loginAttempts.set(ip, { first: now, count: 1 });
  else rec.count += 1;

  if (loginAttempts.size > 5000) {
    for (const [key, value] of loginAttempts) {
      if (now - value.first > ATTEMPT_WINDOW) loginAttempts.delete(key);
    }
  }
}

function passwordMatches(input) {
  const got = sha256(input);
  const want = sha256(APP_PASSWORD);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function readBody(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, up: process.uptime() });
    }

    if (url.pathname === '/api/auth') {
      return json(res, 200, { enabled: Boolean(APP_PASSWORD) });
    }

    if (url.pathname === '/login') {
      if (isAuthed(req)) return redirect(res, '/');
      const page = await fsp.readFile(path.join(ROOT, 'login.html'));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      });
      return res.end(page);
    }

    if (url.pathname === '/api/login') {
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      if (!APP_PASSWORD) return json(res, 400, { error: 'password not configured' });

      const ip = ipOf(req);
      if (!attemptAllowed(ip)) return json(res, 429, { error: 'too many attempts' });

      let body;
      try {
        body = await readBody(req);
      } catch {
        return json(res, 413, { error: 'payload too large' });
      }

      let password = '';
      if (String(req.headers['content-type'] || '').includes('application/json')) {
        try {
          password = JSON.parse(body).password || '';
        } catch { /* ignore malformed body */ }
      } else {
        password = new URLSearchParams(body).get('password') || '';
      }

      if (!passwordMatches(password)) {
        noteFailure(ip);
        return json(res, 401, { error: 'wrong password' });
      }

      loginAttempts.delete(ip);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': sessionCookie(req, newSessionToken()),
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (url.pathname === '/logout') {
      res.writeHead(302, {
        location: APP_PASSWORD ? '/login' : '/',
        'cache-control': 'no-store',
        'set-cookie': sessionCookie(req, '', 0),
      });
      return res.end();
    }

    if (!isAuthed(req)) {
      if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'unauthorized' });
      if (url.pathname === '/__events') {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('unauthorized');
      }
      return redirect(res, '/login');
    }

    if (url.pathname === '/api/chart') {
      const symbol = url.searchParams.get('symbol') || 'XAU=';
      const range = url.searchParams.get('range') || '1D';
      const data = await fetchChart(symbol, range);
      return json(res, 200, data);
    }

    if (url.pathname === '/api/quotes') {
      const symbols = (url.searchParams.get('symbols') || 'XAU=,BTC=,@CL.1,JPY=').split(',');
      const quotes = await fetchQuotes(symbols);
      return json(res, 200, { quotes, now: Date.now() });
    }

    if (url.pathname === '/api/rates') {
      const rates = await fetchFxcm();
      return json(res, 200, { source: 'fxcm', now: Date.now(), rates });
    }

    if (url.pathname === '/__events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const abs = path.join(ROOT, file);
    if (!abs.startsWith(ROOT)) return json(res, 403, { error: 'forbidden' });

    const body = await fsp.readFile(abs);
    res.writeHead(200, {
      'content-type': MIME[path.extname(abs)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    if (url.pathname.startsWith('/api/')) return json(res, 502, { error: String(err.message || err) });
    if (err.code === 'ENOENT') return json(res, 404, { error: 'not found' });
    return json(res, 500, { error: String(err.message || err) });
  }
});

let debounce = null;
for (const f of ['index.html', 'styles.css', 'app.js']) {
  try {
    fs.watch(path.join(ROOT, f), () => {
      clearTimeout(debounce);
      debounce = setTimeout(broadcastReload, 120);
    });
  } catch {
    /* some hosted filesystems do not support file watching */
  }
}

server.listen(PORT, HOST, () => {
  const lan = [];
  if (HOST === '0.0.0.0' || HOST === '::') {
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const n of nets || []) {
        if (n.family === 'IPv4' && !n.internal) lan.push(`http://${n.address}:${PORT}`);
      }
    }
  }

  console.log(`\n  FX Live  →  http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  for (const url of lan) console.log(`             ${url}  (network)`);
  console.log('');
});
