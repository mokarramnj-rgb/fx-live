(() => {
  'use strict';

  /* ------------------------------------------------------------ catalog */

  const CATALOG = [
    { id: 'XAUUSD', symbol: 'XAU=',   label: 'XAU/USD', digits: 2, unit: 'usd',  group: 'METALS' },
    { id: 'XAGUSD', symbol: 'XAG=',   label: 'XAG/USD', digits: 3, unit: 'usd',  group: 'METALS' },
    { id: 'BTCUSD', symbol: 'BTC=',   label: 'BTC/USD', digits: 2, unit: 'usd',  group: 'CRYPTO' },
    { id: 'ETHUSD', symbol: 'ETH=',   label: 'ETH/USD', digits: 2, unit: 'usd',  group: 'CRYPTO' },
    { id: 'USOIL',  symbol: '@CL.1',  label: 'USOIL',   digits: 2, unit: 'usd',  group: 'ENERGY' },
    { id: 'BRENT',  symbol: '@LCO.1', label: 'BRENT',   digits: 2, unit: 'usd',  group: 'ENERGY' },
    { id: 'NATGAS', symbol: '@NG.1',  label: 'NATGAS',  digits: 3, unit: 'usd',  group: 'ENERGY' },
    { id: 'USDJPY', symbol: 'JPY=',   label: 'USD/JPY', digits: 3, unit: 'pips', pip: 0.01,   group: 'FX' },
    { id: 'EURUSD', symbol: 'EUR=',   label: 'EUR/USD', digits: 5, unit: 'pips', pip: 0.0001, group: 'FX' },
    { id: 'GBPUSD', symbol: 'GBP=',   label: 'GBP/USD', digits: 5, unit: 'pips', pip: 0.0001, group: 'FX' },
    { id: 'AUDUSD', symbol: 'AUD=',   label: 'AUD/USD', digits: 5, unit: 'pips', pip: 0.0001, group: 'FX' },
    { id: 'USDCAD', symbol: 'CAD=',   label: 'USD/CAD', digits: 5, unit: 'pips', pip: 0.0001, group: 'FX' },
    { id: 'USDCHF', symbol: 'CHF=',   label: 'USD/CHF', digits: 5, unit: 'pips', pip: 0.0001, group: 'FX' },
    { id: 'SPX',    symbol: '@SP.1',  label: 'S&P 500', digits: 2, unit: 'usd',  group: 'INDICES' },
    { id: 'NDX',    symbol: '@ND.1',  label: 'NASDAQ',  digits: 2, unit: 'usd',  group: 'INDICES' },
  ];

  const DEFAULT_IDS = ['XAUUSD', 'BTCUSD', 'USOIL', 'USDJPY'];

  const TFS = [
    { id: '1m',  ms: 60_000,     range: '1D' },
    { id: '5m',  ms: 300_000,    range: '1D' },
    { id: '15m', ms: 900_000,    range: '1D' },
    { id: '30m', ms: 1_800_000,  range: '1D' },
    { id: '1h',  ms: 3_600_000,  range: '1D' },
    { id: '2h',  ms: 7_200_000,  range: '1D' },
    { id: '4h',  ms: 14_400_000, range: '5D' },
  ];

  const ZOOM_MIN = 5;
  const ZOOM_MAX = 120;
  const ZOOM_STEP = 5;

  const UP = '#2dd4a0';
  const DOWN = '#ff5d78';
  const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
  const STORE = 'fx.pairs.v2';
  const STORE_ACTIVE = 'fx.active.v2';
  const STORE_TF = 'fx.tf.v2';
  const STORE_ZOOM = 'fx.zoom.v2';

  const $ = (id) => document.getElementById(id);

  const state = {
    pairs: [],
    pair: null,
    tf: TFS[0],
    candles: 20,
    series: [],
    market: {},
    display: null,
    target: null,
    loadId: 0,
    lastQuoteAt: 0,
    failures: 0,
    status: '',
    hover: null,
    w: 0,
    h: 0,
    view: { lo: 0, hi: 0, ready: false, snap: true },
  };

  /* ---------------------------------------------------------------- dom */

  const el = {
    pairs: $('pairs'),
    addBtn: $('addBtn'),
    addPop: $('addPop'),
    addList: $('addList'),
    addClose: $('addClose'),
    tfMenu: $('tfMenu'),
    tfTrigger: $('tfTrigger'),
    tfLabel: $('tfLabel'),
    tfPop: $('tfPop'),
    zoomIn: $('zoomIn'),
    zoomOut: $('zoomOut'),
    zoomCount: $('zoomCount'),
    status: $('status'),
    statusText: $('statusText'),
    statusAge: $('statusAge'),
    pairName: $('pairName'),
    price: $('price'),
    priceInt: document.querySelector('#price .price-int'),
    priceFrac: document.querySelector('#price .price-frac'),
    chg: $('chg'),
    sessions: $('sessions'),
    statHigh: $('statHigh'),
    statLow: $('statLow'),
    statRange: $('statRange'),
    open: $('open'),
    prev: $('prev'),
    vol: $('vol'),
    rangeFill: $('rangeFill'),
    rangeDot: $('rangeDot'),
    loader: $('loader'),
    loaderText: $('loaderText'),
    updated: $('updated'),
    lock: $('lock'),
    clock: $('clock'),
    chart: $('chart'),
    card: $('chartCard'),
  };

  const canvas = el.chart;
  const ctx = canvas.getContext('2d');

  /* ---------------------------------------------------------- formatting */

  function fmtPrice(v, digits) {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtSigned(v, digits) {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtPrice(v, digits);
  }

  function compact(n) {
    if (!Number.isFinite(n) || n === 0) return null;
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function rangeText(inst, hi, lo) {
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return '—';
    if (inst.unit === 'pips') return `${Math.round((hi - lo) / inst.pip)} pips`;
    return fmtPrice(hi - lo, inst.digits);
  }

  /* ---------------------------------------------------------------- ui */

  function setStatus(s) {
    if (state.status === s) return;
    state.status = s;
    el.status.dataset.state = s;
    el.statusText.textContent = s === 'live' ? 'LIVE' : s === 'offline' ? 'OFFLINE' : 'SYNC';
  }

  function setLoading(on, text) {
    if (text) el.loaderText.textContent = text;
    el.loader.classList.toggle('hide', !on);
  }

  let lastFlashAt = 0;
  let lastTickDir = 0;
  let pollBusy = false;

  function flash(dir) {
    el.price.classList.remove('flash-up', 'flash-down');
    void el.price.offsetWidth;
    el.price.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
  }

  function paintPrice() {
    if (state.display == null || !state.pair) return;
    const s = fmtPrice(state.display, state.pair.digits);
    const dot = s.lastIndexOf('.');
    const int = dot === -1 ? s : s.slice(0, dot);
    const frac = dot === -1 ? '' : '.' + s.slice(dot + 1);
    if (el.priceInt.textContent !== int) el.priceInt.textContent = int;
    if (el.priceFrac.textContent !== frac) el.priceFrac.textContent = frac;
  }

  function paintQuote() {
    const inst = state.pair;
    const m = inst && state.market[inst.id];
    if (!m) return;

    const { digits, pip } = inst;
    const pct = Number.isFinite(m.changePct) ? m.changePct : 0;
    const dir = pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat';

    el.pairName.textContent = inst.label.split('/').join(' / ');
    el.chg.dataset.dir = dir;
    el.chg.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

    el.statHigh.textContent = fmtPrice(m.high, digits);
    el.statLow.textContent = fmtPrice(m.low, digits);
    el.statRange.textContent = rangeText(inst, m.high, m.low);

    el.open.textContent = fmtPrice(m.open, digits);
    el.prev.textContent = fmtPrice(m.prevClose, digits);
    el.vol.textContent = compact(m.volume) ?? '—';

    const span = m.high - m.low;
    const pos = span > 0 ? Math.min(1, Math.max(0, (m.price - m.low) / span)) : 0.5;
    el.rangeFill.style.width = `${(pos * 100).toFixed(2)}%`;
    el.rangeDot.style.left = `${(pos * 100).toFixed(2)}%`;

    const short = inst.label.replace(/ /g, '');
    document.title = `${short} ${fmtPrice(m.price, digits)} · FX Live`;
  }

  function paintFromSeries() {
    const inst = state.pair;
    if (!inst || !state.series.length) return;
    let hi = -Infinity;
    let lo = Infinity;
    for (const c of state.series) {
      if (c.h > hi) hi = c.h;
      if (c.l < lo) lo = c.l;
    }
    el.statHigh.textContent = fmtPrice(hi, inst.digits);
    el.statLow.textContent = fmtPrice(lo, inst.digits);
    el.statRange.textContent = rangeText(inst, hi, lo);
  }

  function paintClock() {
    const d = new Date();
    el.clock.textContent = d.toISOString().slice(11, 19) + ' UTC';
    paintSessions(d.getTime());
    if (state.lastQuoteAt) {
      const age = Math.max(0, Math.round((Date.now() - state.lastQuoteAt) / 1000));
      el.statusAge.textContent = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
      el.updated.textContent = age <= 2 ? 'updated just now' : `updated ${age}s ago`;
    } else {
      el.updated.textContent = 'connecting to feed';
    }
  }

  /* ------------------------------------------------------- forex sessions */

  /* All four majors are listed at once. Each row turns green while its session
     is open (with a closing countdown) and red while closed (with an opening
     countdown). London/New York follow their local DST rules; Sydney/Tokyo use
     fixed UTC windows. The market itself runs Sunday 22:00 → Friday 22:00 UTC. */

  const SESSION_DEFS = [
    { name: 'Sydney',   start: 22 * 60, end: 7 * 60 },
    { name: 'Tokyo',    start: 0,       end: 9 * 60 },
    { name: 'London',   start: 8 * 60,  end: 17 * 60 },
    { name: 'New York', start: 13 * 60, end: 22 * 60 },
  ];

  let sessionRows = [];
  let sessionCache = { key: -1, data: [] };

  function nthSunday(year, month, n) {
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
  }

  function lastSunday(year, month) {
    const d = new Date(Date.UTC(year, month + 1, 0));
    return d.getUTCDate() - d.getUTCDay();
  }

  function usDst(d) {
    const y = d.getUTCFullYear();
    const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7);
    const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6);
    return d.getTime() >= start && d.getTime() < end;
  }

  function euDst(d) {
    const y = d.getUTCFullYear();
    const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
    const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
    return d.getTime() >= start && d.getTime() < end;
  }

  function sessionBounds(def, d) {
    if (def.name === 'London') {
      return euDst(d)
        ? { start: 7 * 60, end: 16 * 60 }
        : { start: 8 * 60, end: 17 * 60 };
    }
    if (def.name === 'New York') {
      return usDst(d)
        ? { start: 12 * 60, end: 21 * 60 }
        : { start: 13 * 60, end: 22 * 60 };
    }
    return { start: def.start, end: def.end };
  }

  function dayStartMs(d) {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function marketOpenAt(d) {
    const day = d.getUTCDay();
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const nyEnd = (usDst(d) ? 21 : 22) * 60;
    return !(day === 6 || (day === 0 && mins < 22 * 60) || (day === 5 && mins >= nyEnd));
  }

  function sessionOpenAt(def, d) {
    if (!marketOpenAt(d)) return false;
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const { start, end } = sessionBounds(def, d);
    return end > start
      ? mins >= start && mins < end
      : mins >= start || mins < end;
  }

  function nextClose(def, d) {
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const { start, end } = sessionBounds(def, d);
    const base = dayStartMs(d);
    if (end > start) return base + end * 60_000;
    return (mins >= start ? base + 86_400_000 : base) + end * 60_000;
  }

  function nextOpen(def, d) {
    let base = dayStartMs(d);
    for (let i = 0; i < 8; i++) {
      const day = new Date(base);
      const { start } = sessionBounds(def, day);
      const open = base + start * 60_000;
      if (open > d.getTime() && marketOpenAt(new Date(open))) return open;
      base += 86_400_000;
    }
    return null;
  }

  function fmtCountdown(ms) {
    if (ms === null || ms === undefined) return '—';
    const mins = Math.floor(Math.max(0, ms) / 60_000);
    if (mins < 1) return '<1m';
    const days = Math.floor(mins / 1440);
    const hours = Math.floor((mins % 1440) / 60);
    const rest = mins % 60;
    if (days) return `${days}d ${hours}h`;
    if (hours) return rest ? `${hours}h ${rest}m` : `${hours}h`;
    return `${rest}m`;
  }

  function computeSessions(d) {
    return SESSION_DEFS.map((def) => {
      const open = sessionOpenAt(def, d);
      const next = open ? nextClose(def, d) : nextOpen(def, d);
      return { open, remain: next === null ? null : Math.max(0, next - d.getTime()) };
    });
  }

  function buildSessions() {
    el.sessions.innerHTML = '';
    sessionRows = SESSION_DEFS.map((def) => {
      const row = document.createElement('div');
      row.className = 'session-row';
      row.dataset.state = 'closed';
      row.setAttribute('role', 'listitem');

      const dot = document.createElement('span');
      dot.className = 'session-dot';

      const name = document.createElement('span');
      name.className = 'session-name';
      name.textContent = def.name.toUpperCase();

      const time = document.createElement('span');
      time.className = 'session-time';
      time.textContent = '[—]';

      row.append(dot, name, time);
      el.sessions.append(row);
      return { def, row, time };
    });
  }

  function paintSessions(nowMs = Date.now()) {
    const key = Math.floor(nowMs / 60_000);
    if (sessionCache.key !== key) {
      sessionCache = { key, data: computeSessions(new Date(nowMs)) };
    }

    for (let i = 0; i < sessionRows.length; i++) {
      const { def, row, time } = sessionRows[i];
      const info = sessionCache.data[i];
      const cd = fmtCountdown(info.remain);
      const label = info.open ? 'Closing after' : 'Opening after';
      row.dataset.state = info.open ? 'open' : 'closed';
      time.textContent = `[${label} ${cd}]`;
      row.title = `${def.name} session · ${label.toLowerCase()} ${cd}`;
    }
  }

  /* -------------------------------------------------------------- pairs */

  function loadPairs() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (Array.isArray(stored)) {
        const list = stored.map((id) => CATALOG.find((c) => c.id === id)).filter(Boolean);
        if (list.length) return list;
      }
    } catch { /* ignore */ }
    return DEFAULT_IDS.map((id) => CATALOG.find((c) => c.id === id));
  }

  function savePairs() {
    localStorage.setItem(STORE, JSON.stringify(state.pairs.map((p) => p.id)));
  }

  function renderPairs() {
    el.pairs.innerHTML = '';
    for (const inst of state.pairs) {      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pair-btn' + (inst.id === state.pair.id ? ' active' : '');
      b.title = inst.label;
      b.append(Object.assign(document.createElement('span'), { textContent: inst.label }));

      if (state.pairs.length > 1) {
        const x = document.createElement('span');
        x.className = 'pair-x';
        x.textContent = '×';
        x.title = `Remove ${inst.label}`;
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          removePair(inst.id);
        });
        b.append(x);
      }

      b.addEventListener('click', () => selectPair(inst.id));
      el.pairs.append(b);
    }

    const active = el.pairs.querySelector('.pair-btn.active');
    if (active) {
      requestAnimationFrame(() => {
        const pr = el.pairs.getBoundingClientRect();
        const ar = active.getBoundingClientRect();
        if (ar.left < pr.left) el.pairs.scrollLeft -= pr.left - ar.left + 4;
        else if (ar.right > pr.right) el.pairs.scrollLeft += ar.right - pr.right + 4;
        markOverflow();
      });
    }
  }

  function markOverflow() {
    const p = el.pairs;
    const start = p.scrollLeft > 1;
    const end = p.scrollLeft + p.clientWidth < p.scrollWidth - 1;
    p.dataset.overflow = start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
  }

  function renderCatalog() {
    el.addList.innerHTML = '';
    const available = CATALOG.filter((c) => !state.pairs.some((p) => p.id === c.id));

    if (!available.length) {
      const empty = document.createElement('div');
      empty.className = 'add-empty';
      empty.textContent = 'ALL INSTRUMENTS ADDED';
      el.addList.append(empty);
      return;
    }

    const groups = [...new Set(available.map((c) => c.group))];
    for (const g of groups) {
      const head = document.createElement('div');
      head.className = 'add-group';
      head.textContent = g;
      el.addList.append(head);

      for (const inst of available.filter((c) => c.group === g)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'add-item';
        const name = document.createElement('span');
        name.textContent = inst.label;
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = inst.unit === 'pips' ? 'FX' : 'USD';
        b.append(name, tag);
        b.addEventListener('click', () => {
          addPair(inst.id);
          closeAdd();
        });
        el.addList.append(b);
      }
    }
  }

  function openAdd() {
    closeTf();
    const r = el.addBtn.getBoundingClientRect();
    renderCatalog();
    el.addPop.hidden = false;
    const w = 288;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    el.addPop.style.left = `${left}px`;
    el.addPop.style.top = `${Math.round(r.bottom + 8)}px`;
  }

  function closeAdd() {
    el.addPop.hidden = true;
  }

  function addPair(id) {
    const inst = CATALOG.find((c) => c.id === id);
    if (!inst) return;
    if (!state.pairs.some((p) => p.id === id)) {
      state.pairs.push(inst);
      savePairs();
    }
    selectPair(id);
  }

  function removePair(id) {
    if (state.pairs.length <= 1) return;
    const idx = state.pairs.findIndex((p) => p.id === id);
    if (idx === -1) return;

    state.pairs.splice(idx, 1);
    savePairs();

    if (state.pair.id === id) {
      const next = state.pairs[Math.min(idx, state.pairs.length - 1)];
      state.pair = next;
      localStorage.setItem(STORE_ACTIVE, next.id);
      resetView();
      renderPairs();
      loadChart({ snap: true });
    } else {
      renderPairs();
    }
  }

  function resetView() {
    state.series = [];
    state.display = null;
    state.target = null;
    state.hover = null;
    state.view.snap = true;
    state.lastQuoteAt = 0;
    lastTickDir = 0;

    el.chg.dataset.dir = 'flat';
    el.chg.textContent = '—';
    el.statHigh.textContent = '—';
    el.statLow.textContent = '—';
    el.statRange.textContent = '—';
    el.open.textContent = '—';
    el.prev.textContent = '—';
    el.vol.textContent = '—';
  }

  function selectPair(id) {
    const inst = state.pairs.find((p) => p.id === id);
    if (!inst || (state.pair && state.pair.id === id)) {
      if (inst) renderPairs();
      return;
    }

    state.pair = inst;
    localStorage.setItem(STORE_ACTIVE, id);
    resetView();
    renderPairs();
    el.pairName.textContent = inst.label.split('/').join(' / ');
    loadChart({ snap: true });

    const q = state.market[inst.id];
    if (q) {
      state.display = q.price;
      state.target = q.price;
      state.lastQuoteAt = Date.now();
      paintQuote();
      paintPrice();
    }
  }

  /* -------------------------------------------------------------- data */

  async function loadChart({ snap = false } = {}) {
    const inst = state.pair;
    if (!inst) return;

    const token = ++state.loadId;
    const tf = state.tf;

    try {
      if (snap) setLoading(true, 'loading market data');

      const res = await fetch(
        `/api/chart?symbol=${encodeURIComponent(inst.symbol)}&range=${tf.range}&_=${Date.now()}`,
      );
      if (res.status === 401) {
        location.replace('/login');
        return;
      }
      if (!res.ok) throw new Error('chart failed');
      const data = await res.json();
      if (token !== state.loadId) return;

      let bars = data.bars || [];
      if (tf.ms > 60_000) bars = aggregate(bars, tf.ms);
      bars = synthesize(bars);
      if (bars.length < 2) throw new Error('no bars');

      state.series = bars;
      if (snap) state.view.snap = true;

      const cap = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, bars.length));
      if (state.candles > cap) {
        state.candles = cap;
        localStorage.setItem(STORE_ZOOM, String(cap));
      }
      paintZoom();

      const q = state.market[inst.id];
      if (q) {
        applyQuote(q, inst);
        paintQuote();
      } else {
        const close = bars[bars.length - 1].c;
        state.display = close;
        state.target = close;
        paintFromSeries();
      }

      setLoading(false);
      setStatus('live');
    } catch {
      if (token !== state.loadId) return;
      setLoading(false);
      setStatus('offline');
    }
  }

  function aggregate(bars, tfMs) {
    const out = [];
    for (const b of bars) {
      const t = Math.floor(b.t / tfMs) * tfMs;
      const last = out[out.length - 1];
      if (!last || last.t !== t) {
        out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      } else {
        if (b.h > last.h) last.h = b.h;
        if (b.l < last.l) last.l = b.l;
        last.c = b.c;
        last.v += b.v;
      }
    }
    return out;
  }

  /* Some CNBC intraday feeds (spot gold, spot FX) return close-only bars where
     open/high/low all equal close. Reconstruct a tradable candle by carrying
     the previous close forward as the open. Aggregated timeframes already get
     real high/low from the bucket, so this only touches the 1m series. */

  function synthesize(bars) {
    let prev = null;
    for (const b of bars) {
      if (b.o === b.h && b.h === b.l && b.l === b.c && prev !== null) {
        b.o = prev;
        b.h = Math.max(b.o, b.c);
        b.l = Math.min(b.o, b.c);
      }
      prev = b.c;
    }
    return bars;
  }

  async function pollQuotes() {
    if (!state.pairs.length || pollBusy) return;
    pollBusy = true;
    const symbols = state.pairs.map((p) => p.symbol);

    try {
      const res = await fetch(
        `/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}&_=${Date.now()}`,
      );
      if (res.status === 401) {
        location.replace('/login');
        return;
      }
      if (!res.ok) throw new Error('quotes failed');
      const data = await res.json();
      if (!Array.isArray(data.quotes)) throw new Error('empty quotes');

      for (const q of data.quotes) {
        const inst = state.pairs.find((p) => p.symbol === q.symbol);
        if (!inst) continue;
        state.market[inst.id] = q;
        if (state.pair && inst.id === state.pair.id) {
          state.lastQuoteAt = Date.now();
          applyQuote(q, inst);
          paintQuote();
        }
      }

      state.failures = 0;
      setStatus('live');
    } catch {
      state.failures += 1;
      if (state.failures >= 2) setStatus('offline');
    } finally {
      pollBusy = false;
    }
  }

  function applyQuote(q, inst) {
    if (!q || !Number.isFinite(q.price)) return;

    const prev = state.target;
    state.target = q.price;

    if (prev != null && q.price !== prev) {
      const dir = q.price > prev ? 1 : -1;
      if (dir !== lastTickDir && Date.now() - lastFlashAt > 600) {
        flash(dir);
        lastFlashAt = Date.now();
      }
      lastTickDir = dir;
    }
    if (state.display == null) state.display = q.price;

    const tf = state.tf;
    const ts = q.ts || Date.now();
    const bucket = Math.floor(ts / tf.ms) * tf.ms;

    let last = state.series[state.series.length - 1];
    if (last && bucket > last.t) {
      state.series.push({ t: bucket, o: last.c, h: q.price, l: q.price, c: q.price, v: 0 });
      last = state.series[state.series.length - 1];
    }
    if (last && bucket >= last.t) {
      last.c = q.price;
      if (q.price > last.h) last.h = q.price;
      if (q.price < last.l) last.l = q.price;
    }

    const bars = state.series;
    if (bars.length > 900) state.series = bars.slice(-900);
  }

  /* -------------------------------------------------------------- chart */

  function resize() {
    const r = el.card.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    state.w = Math.max(280, r.width);
    state.h = Math.max(160, r.height);
    canvas.width = Math.round(state.w * dpr);
    canvas.height = Math.round(state.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.view.snap = true;
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function timeLabel(ms) {
    const d = new Date(ms);
    return d.toISOString().slice(11, 16);
  }

  function dayLabel(ms) {
    return new Date(ms)
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
      .toUpperCase();
  }

  function hoverTime(ms) {
    const d = new Date(ms);
    if (state.tf.ms >= 3_600_000) return d.toISOString().slice(5, 16).replace('T', ' ') + ' UTC';
    return d.toISOString().slice(11, 16) + ' UTC';
  }

  function draw(now) {
    const W = state.w;
    const H = state.h;
    const inst = state.pair;
    if (!inst) return;
    const { digits } = inst;

    ctx.clearRect(0, 0, W, H);

    const pad = { l: 10, r: 80, t: 16, b: 26 };
    const x1 = W - pad.r;
    const y1 = H - pad.b;
    const plotW = x1 - pad.l;
    const plotH = y1 - pad.t;

    if (plotW < 40 || plotH < 40) return;

    const n = Math.min(state.series.length, state.candles);

    if (n < 2) {
      drawEmpty(pad, x1, y1);
      return;
    }

    const data = state.series.slice(-n);

    let lo = Infinity;
    let hi = -Infinity;
    for (const c of data) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    if (state.display != null) {
      if (state.display < lo) lo = state.display;
      if (state.display > hi) hi = state.display;
    }

    const rawSpan = hi - lo;
    const minSpan = Math.pow(10, -digits) * 2;
    const spanPad = Math.max(rawSpan * 0.16, minSpan * 0.5);
    let targetLo = lo - spanPad;
    let targetHi = hi + spanPad;
    if (targetHi - targetLo < minSpan) {
      const mid = (targetHi + targetLo) / 2;
      targetLo = mid - minSpan / 2;
      targetHi = mid + minSpan / 2;
    }

    const view = state.view;
    if (!view.ready || view.snap) {
      view.lo = targetLo;
      view.hi = targetHi;
      view.ready = true;
      view.snap = false;
    } else {
      const k = 0.16;
      view.lo += (targetLo - view.lo) * k;
      view.hi += (targetHi - view.hi) * k;
    }

    const loV = view.lo;
    const hiV = view.hi;
    const toY = (p) => pad.t + ((hiV - p) / (hiV - loV)) * plotH;
    const slot = plotW / n;
    const barW = Math.min(34, Math.max(2, slot * 0.64));
    const xOf = (i) => pad.l + (i + 0.5) * slot;

    /* grid ------------------------------------------------------------ */

    const step = niceStep((hiV - loV) / 5);
    const start = Math.ceil(loV / step) * step;
    ctx.font = `500 9px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';

    for (let p = start; p <= hiV + step * 0.01; p += step) {
      const y = Math.round(toY(p)) + 0.5;
      if (y < pad.t - 1 || y > y1 + 1) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.042)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      ctx.fillStyle = '#5a6473';
      ctx.fillText(fmtPrice(p, digits), W - 7, y);
    }

    ctx.textAlign = 'center';
    const spanMs = data[n - 1].t - data[0].t;
    const HOUR = 3_600_000;
    const DAY = 86_400_000;
    let stepMs;
    if (state.tf.ms >= 14_400_000) stepMs = DAY;
    else if (state.tf.ms <= 1_800_000) stepMs = state.tf.ms * 3;
    else stepMs = spanMs > 30 * HOUR ? 6 * HOUR : 3 * HOUR;

    for (let i = 0; i < n; i++) {
      const t = data[i].t;
      if (t % stepMs !== 0) continue;
      const x = Math.round(xOf(i)) + 0.5;
      if (x < pad.l + 94 || x > x1 - 12) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, y1);
      ctx.stroke();

      ctx.fillStyle = '#4f5968';
      ctx.fillText(t % DAY === 0 ? dayLabel(t) : timeLabel(t), x, H - 12);
    }

    /* candles --------------------------------------------------------- */

    for (let i = 0; i < n; i++) {
      const c = data[i];
      const isLast = i === n - 1;
      const close = isLast && state.display != null ? state.display : c.c;
      const high = isLast ? Math.max(c.h, close) : c.h;
      const low = isLast ? Math.min(c.l, close) : c.l;
      const up = close >= c.o;
      const color = up ? UP : DOWN;
      const x = xOf(i);

      const yh = toY(high);
      const yl = toY(low);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(Math.round(x) - 0.5, yh, 1, Math.max(1, yl - yh));

      const yo = toY(c.o);
      const yc = toY(close);
      const top = Math.min(yo, yc);
      const bodyH = Math.max(1, Math.abs(yc - yo));
      ctx.globalAlpha = isLast ? 1 : 0.92;
      ctx.fillRect(x - barW / 2, top, barW, bodyH);
      ctx.globalAlpha = 1;
    }

    /* last price ------------------------------------------------------ */

    const last = data[n - 1];
    const lastPrice = state.display != null ? state.display : last.c;
    const q = state.market[inst.id];
    const dayUp = !q || (q.changePct ?? 0) >= 0;
    const lineColor = dayUp ? UP : DOWN;
    const ly = Math.max(pad.t + 1, Math.min(y1 - 1, toY(lastPrice)));

    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = lineColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, ly);
    ctx.lineTo(x1, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const pillH = 19;
    const priceTxt = fmtPrice(lastPrice, digits);
    ctx.font = `700 10px ${MONO}`;
    const pillW = Math.max(52, ctx.measureText(priceTxt).width + 14);
    const pillY = Math.max(pad.t + 1, Math.min(y1 - pillH - 1, ly - pillH / 2));
    ctx.fillStyle = lineColor;
    roundRect(x1 + 5, pillY, pillW, pillH, 5);
    ctx.fill();
    ctx.fillStyle = '#07090c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(priceTxt, x1 + 5 + pillW / 2, pillY + pillH / 2 + 0.5);

    const dotX = xOf(n - 1);
    const glow = 0.35 + 0.3 * (Math.sin(now / 380) * 0.5 + 0.5);
    ctx.beginPath();
    ctx.fillStyle = lineColor;
    ctx.globalAlpha = glow * 0.35;
    ctx.arc(dotX, ly, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.fillStyle = lineColor;
    ctx.arc(dotX, ly, 2.6, 0, Math.PI * 2);
    ctx.fill();

    /* crosshair ------------------------------------------------------- */

    const hv = state.hover;
    if (hv && hv.x > pad.l && hv.x < x1 && hv.y > pad.t && hv.y < y1) {
      const idx = Math.max(0, Math.min(n - 1, Math.floor((hv.x - pad.l) / (plotW / n))));
      const c = data[idx];
      const cx = Math.round(xOf(idx)) + 0.5;
      const tx = hv.x;
      const ty = hv.y;

      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(233,238,246,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, pad.t);
      ctx.lineTo(cx, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad.l, Math.round(ty) + 0.5);
      ctx.lineTo(x1, Math.round(ty) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      const hovPrice = hiV - ((ty - pad.t) / plotH) * (hiV - loV);
      const hpTxt = fmtPrice(hovPrice, digits);
      ctx.font = `500 9px ${MONO}`;
      const hpW = ctx.measureText(hpTxt).width + 14;
      const hpy = Math.max(pad.t, Math.min(y1 - 17, ty - 8.5));
      ctx.fillStyle = '#1b212c';
      roundRect(x1 + 5, hpy, hpW, 17, 4);
      ctx.fill();
      ctx.fillStyle = '#c7d1de';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hpTxt, x1 + 5 + hpW / 2, hpy + 9);

      const label = spanMs > 24 * HOUR ? `${dayLabel(c.t)} ${timeLabel(c.t)}` : timeLabel(c.t);
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = '#1b212c';
      roundRect(cx - tw / 2, y1 + 4, tw, 16, 4);
      ctx.fill();
      ctx.fillStyle = '#c7d1de';
      ctx.fillText(label, cx, y1 + 12.5);

      /* tooltip */
      const boxW = 130;
      const boxH = 96;
      let bx = tx + 16;
      let by = ty + 16;
      if (bx + boxW > x1 - 8) bx = tx - boxW - 16;
      if (by + boxH > y1 - 6) by = ty - boxH - 16;
      bx = Math.max(pad.l + 4, bx);
      by = Math.max(pad.t + 2, by);

      ctx.fillStyle = 'rgba(12,15,20,0.94)';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      roundRect(bx, by, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `500 8px ${MONO}`;
      ctx.fillStyle = '#6f7a89';
      ctx.fillText(hoverTime(c.t), bx + 10, by + 13);

      const closeVal = idx === n - 1 && state.display != null ? state.display : c.c;
      const rows = [['O', c.o], ['H', c.h], ['L', c.l], ['C', closeVal]];
      const move = closeVal - c.o;

      rows.forEach(([k, v], i) => {
        const ry = by + 30 + i * 15;
        ctx.font = `500 8.5px ${MONO}`;
        ctx.fillStyle = '#5f6a79';
        ctx.fillText(k, bx + 10, ry);
        ctx.font = `500 9.5px ${MONO}`;
        ctx.fillStyle = i === 3 ? (closeVal >= c.o ? UP : DOWN) : '#d3dce8';
        ctx.textAlign = 'right';
        ctx.fillText(fmtPrice(v, digits), bx + boxW - 10, ry);
        ctx.textAlign = 'left';
      });

      const moveTxt = inst.unit === 'pips'
        ? `${move >= 0 ? '+' : ''}${(move / inst.pip).toFixed(1)} pips`
        : fmtSigned(move, digits);

      ctx.font = `500 8.5px ${MONO}`;
      ctx.fillStyle = '#5f6a79';
      ctx.fillText('MOVE', bx + 10, by + 86);
      ctx.textAlign = 'right';
      ctx.fillStyle = move >= 0 ? UP : DOWN;
      ctx.fillText(moveTxt, bx + boxW - 10, by + 86);
      ctx.textAlign = 'left';
    }
  }

  function drawEmpty(pad, x1, y1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = Math.round(pad.t + ((y1 - pad.t) / 5) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#3d4653';
    ctx.font = `500 10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WAITING FOR MARKET DATA', (pad.l + x1) / 2, (pad.t + y1) / 2);
  }

  /* --------------------------------------------------------------- loop */

  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    if (state.display == null) {
      draw(now);
      return;
    }
    const k = 0.18;
    const diff = state.target - state.display;
    const eps = state.pair ? Math.pow(10, -state.pair.digits) * 0.05 : 0.00001;
    if (Math.abs(diff) < eps) state.display = state.target;
    else state.display += diff * k;
    paintPrice();
    draw(now);
  }

  /* ------------------------------------------------------------- events */

  function bindEvents() {
    new ResizeObserver(resize).observe(el.card);
    el.pairs.addEventListener('scroll', markOverflow, { passive: true });

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      state.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    });

    canvas.addEventListener('mouseleave', () => {
      state.hover = null;
    });

    el.addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.addPop.hidden) openAdd();
      else closeAdd();
    });

    el.addClose.addEventListener('click', closeAdd);

    el.tfTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAdd();
      if (el.tfPop.hidden) openTf();
      else closeTf();
    });

    el.zoomIn.addEventListener('click', () => setCandles(state.candles - ZOOM_STEP));
    el.zoomOut.addEventListener('click', () => setCandles(state.candles + ZOOM_STEP));

    document.addEventListener('mousedown', (e) => {
      if (!el.addPop.hidden && !el.addPop.contains(e.target) && !el.addBtn.contains(e.target)) closeAdd();
      if (!el.tfPop.hidden && !el.tfMenu.contains(e.target)) closeTf();
    });

    window.addEventListener('resize', () => {
      if (!el.addPop.hidden) openAdd();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAdd();
        closeTf();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const num = Number(e.key);
      if (num >= 1 && num <= Math.min(9, state.pairs.length)) {
        selectPair(state.pairs[num - 1].id);
      }
      if (e.key === '[') selectTf(TFS[Math.max(0, TFS.indexOf(state.tf) - 1)].id);
      if (e.key === ']') selectTf(TFS[Math.min(TFS.length - 1, TFS.indexOf(state.tf) + 1)].id);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      pollQuotes();
      loadChart();
    });

    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      const es = new EventSource('/__events');
      es.onmessage = (e) => {
        if (e.data === 'reload') location.reload();
      };
    }
  }

  function buildTimeframes() {
    el.tfPop.innerHTML = '';
    for (const t of TFS) {
      const b = document.createElement('button');
      b.className = 'tf-opt';
      b.type = 'button';
      b.dataset.id = t.id;
      b.textContent = t.id.toUpperCase();
      b.setAttribute('role', 'option');
      b.addEventListener('click', () => {
        selectTf(t.id);
        closeTf();
      });
      el.tfPop.append(b);
    }
  }

  function paintTf() {
    el.tfLabel.textContent = state.tf.id.toUpperCase();
    for (const b of el.tfPop.children) {
      const on = b.dataset.id === state.tf.id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
  }

  function openTf() {
    el.tfPop.hidden = false;
    el.tfTrigger.setAttribute('aria-expanded', 'true');
    el.tfMenu.classList.add('open');
  }

  function closeTf() {
    if (el.tfPop.hidden) return;
    el.tfPop.hidden = true;
    el.tfTrigger.setAttribute('aria-expanded', 'false');
    el.tfMenu.classList.remove('open');
  }

  function zoomCap() {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.series.length || ZOOM_MAX));
  }

  function setCandles(n) {
    const next = Math.max(ZOOM_MIN, Math.min(zoomCap(), Math.round(n)));
    if (next === state.candles) return;
    state.candles = next;
    localStorage.setItem(STORE_ZOOM, String(next));
    paintZoom();
    state.view.snap = true;
  }

  function paintZoom() {
    el.zoomCount.textContent = String(state.candles);
    const cap = zoomCap();
    el.zoomIn.disabled = state.candles <= ZOOM_MIN;
    el.zoomOut.disabled = state.candles >= cap;
  }

  function selectTf(id) {
    if (id === state.tf.id) return;
    const t = TFS.find((x) => x.id === id);
    if (!t) return;
    state.tf = t;
    localStorage.setItem(STORE_TF, id);
    state.series = [];
    state.view.snap = true;
    paintTf();
    loadChart({ snap: true });
  }

  /* --------------------------------------------------------------- boot */

  /* Reveal the LOCK link only when the server actually enforces a password. */

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (el.lock) el.lock.hidden = !data.enabled;
    } catch {
      /* offline: keep the link hidden */
    }
  }

  async function boot() {
    state.tf = TFS.find((t) => t.id === localStorage.getItem(STORE_TF)) || TFS[0];
    const savedZoom = Number(localStorage.getItem(STORE_ZOOM));
    if (Number.isFinite(savedZoom) && savedZoom >= ZOOM_MIN) {
      state.candles = Math.min(ZOOM_MAX, Math.round(savedZoom));
    }
    buildTimeframes();
    paintTf();
    paintZoom();
    buildSessions();
    bindEvents();
    resize();

    state.pairs = loadPairs();
    const savedActive = localStorage.getItem(STORE_ACTIVE);
    state.pair = state.pairs.find((p) => p.id === savedActive) || state.pairs[0];
    renderPairs();
    el.pairName.textContent = state.pair.label.split('/').join(' / ');
    paintClock();

    requestAnimationFrame(frame);

    checkAuth();
    pollQuotes();
    await loadChart({ snap: true });
    setLoading(false);

    setInterval(pollQuotes, 1000);
    setInterval(() => {
      if (!document.hidden) loadChart();
    }, 25_000);
    setInterval(paintClock, 1000);
  }

  boot();
})();
