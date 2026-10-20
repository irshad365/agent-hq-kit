#!/usr/bin/env node
// Z.ai (GLM coding plan) quota fetcher. Called only by office-usage.mjs (detached child), or by hand:
//   node office-glm.mjs --once     bypass the throttle, print ONE summary line (never the key)
// Writes office/glm.json (single writer, atomic rename). Never throws, prints nothing as a module.
// The key is read exactly once, below, from the inherited environment and only sent as a Bearer header.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OFFICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60000;
const FETCH_EVERY = 10 * MIN;   // any attempt
const UNAUTH_EVERY = 60 * MIN;  // after an 'unauthorized' result
const TIMEOUT = 4000;

// One place to fix if Z.ai changes shape. Verified against the live API on 2026-10-19 (quota/limit only):
//   {code, msg, success, data: {level, limits: [{type, unit, number, percentage, nextResetTime, ...}]}}
//   TOKENS_LIMIT unit 3 / number 5 = the 5-hour window. Weekly (unit 6) is absent on the lite plan today.
// model-usage: epoch-seconds startTime/endTime returned HTTP 200 with body code 500 (success:false); the
// "YYYY-MM-DD HH:mm:ss" form below parsed into a model list on a live run (field names are a best guess that matched).
export const FIELDMAP = {
  quotaPath: '/api/monitor/usage/quota/limit',
  modelPath: '/api/monitor/usage/model-usage',
  limitsPath: ['data', 'limits'],
  tokenType: 'TOKENS_LIMIT',
  windows: { h5: 3, wk: 6 },          // TOKENS_LIMIT `unit` -> window
  pct: 'percentage', resetAt: 'nextResetTime', usedRaw: 'currentValue', limitRaw: 'usage',
  modelListKeys: ['modelDataList', 'modelSummaryList', 'modelUsageList', 'list'], // under data; first array found
  modelName: ['modelName', 'model', 'name'], modelTokens: ['totalTokens', 'tokens', 'total_tokens'],
  timeFormat: 'datetime',             // 'datetime' = "YYYY-MM-DD HH:mm:ss" local; 'seconds' | 'ms' also supported
};

const ERRORS = new Set(['unauthorized', 'quota', 'network', 'shape']);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const pct = (x) => { const n = num(x); return n === null ? null : Math.round(Math.min(100, Math.max(0, n)) * 10) / 10; };
const epochMs = (x) => { const n = num(x); if (n === null || n <= 0) return null; return n < 1e11 ? n * 1000 : n; };
const dig = (o, p) => p.reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o);

const emptyGlm = () => ({ updatedAt: 0, fetchedAt: null, source: 'local', usedPct: null, used: null, limit: null,
  resetsAt: null, h5: { usedPct: null, resetsAt: null }, wk: { usedPct: null, resetsAt: null }, models: [], error: null });

function readPrev(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const g = emptyGlm();
    g.updatedAt = num(j.updatedAt) || 0;
    g.fetchedAt = num(j.fetchedAt);
    g.source = j.source === 'zai' ? 'zai' : 'local';
    for (const w of ['h5', 'wk']) g[w] = { usedPct: pct(j[w] && j[w].usedPct), resetsAt: epochMs(j[w] && j[w].resetsAt) };
    g.usedPct = g.h5.usedPct; g.resetsAt = g.h5.resetsAt;
    g.used = num(j.used); g.limit = num(j.limit);
    g.models = cleanModels(j.models);
    g.error = ERRORS.has(j.error) ? j.error : null;
    return g;
  } catch { return null; }
}

function cleanModels(m) {
  if (!Array.isArray(m)) return [];
  const out = [];
  for (const e of m) {
    if (!e || typeof e.name !== 'string' || num(e.tokens) === null) continue;
    out.push({ name: e.name.slice(0, 40), tokens: e.tokens });
    if (out.length >= 6) break;
  }
  return out;
}

// quota/limit body -> { h5, wk, used, limit } or null when the shape is unknown.
export function parseQuota(body) {
  const list = dig(body, FIELDMAP.limitsPath);
  if (!Array.isArray(list)) return null;
  const toks = list.filter((e) => e && e.type === FIELDMAP.tokenType);
  if (!toks.length) return null;
  const out = { h5: { usedPct: null, resetsAt: null }, wk: { usedPct: null, resetsAt: null }, used: null, limit: null };
  let any = false;
  for (const w of ['h5', 'wk']) {
    const e = toks.find((x) => x.unit === FIELDMAP.windows[w]);
    if (!e) continue;
    const p = pct(e[FIELDMAP.pct]);
    out[w] = { usedPct: p, resetsAt: epochMs(e[FIELDMAP.resetAt]) };
    if (p !== null) any = true;
    if (w === 'h5') {
      const u = num(e[FIELDMAP.usedRaw]), l = num(e[FIELDMAP.limitRaw]);
      if (u !== null && l !== null && l > 0) { out.used = u; out.limit = l; }
    }
  }
  return any ? out : null;
}

// model-usage body -> [{name, tokens}] (<= 6, biggest first) or null when unrecognised.
export function parseModels(body) {
  const d = body && body.data;
  if (!d || typeof d !== 'object') return null;
  let arr = Array.isArray(d) ? d : null;
  for (const k of FIELDMAP.modelListKeys) if (!arr && Array.isArray(d[k])) arr = d[k];
  if (!arr) return null;
  const out = [];
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const n = FIELDMAP.modelName.map((k) => e[k]).find((v) => typeof v === 'string' && v);
    const t = FIELDMAP.modelTokens.map((k) => num(e[k])).find((v) => v !== null);
    if (n !== undefined && t !== undefined) out.push({ name: n.slice(0, 40), tokens: t });
  }
  return cleanModels(out.sort((a, b) => b.tokens - a.tokens));
}

function timeArgs(now) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const f = FIELDMAP.timeFormat;
  if (f === 'seconds') return [Math.floor(d.getTime() / 1000), Math.floor(now / 1000)];
  if (f === 'ms') return [d.getTime(), now];
  const p = (x) => String(x).padStart(2, '0');
  const s = (t) => { const x = new Date(t); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`; };
  return [s(d.getTime()), s(now)];
}

// Maps one HTTP result to an error enum (null = fine). `body` may be null when the body was not JSON.
function classify(status, body) {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'quota';
  if (status !== 200) return 'network';
  if (body === null) return 'network';
  if (body && body.success === false) {
    const c = Number(body.code);
    if (c === 401 || c === 403) return 'unauthorized';
    if (c === 429) return 'quota';
    return 'network';
  }
  return null;
}

async function call(fetchFn, base, key, p) {
  try {
    const r = await fetchFn(base + p, { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT) });
    let body = null; try { body = JSON.parse(await r.text()); } catch {}
    return { error: classify(r.status, body), body };
  } catch { return { error: 'network', body: null }; }
}

export async function refreshGlm({ fetch: fetchFn = globalThis.fetch, now = Date.now, dir = OFFICE, force = false } = {}) {
  try {
    const key = process.env.ZAI_API_KEY;               // the single read of the key
    if (!key) return { skipped: 'nokey' };
    const file = path.join(dir, 'glm.json'), stamp = path.join(dir, '.glm-fetch');
    const t = now();
    const prev = readPrev(file);
    if (!force) {
      let last = 0; try { last = fs.statSync(stamp).mtimeMs; } catch {}
      const every = prev && prev.error === 'unauthorized' ? UNAUTH_EVERY : FETCH_EVERY;
      if (last && t - last < every) return { skipped: 'throttle' };
    }
    fs.writeFileSync(stamp, '', { mode: 0o600 });       // touch BEFORE fetching
    fs.utimesSync(stamp, t / 1000, t / 1000);

    let base = 'https://api.z.ai';
    const tb = process.env.ZAI_BASE;
    if (process.env.AGENT_HQ_TEST === '1' && typeof tb === 'string' && tb.startsWith('http://127.0.0.1')) base = tb.replace(/\/+$/, '');
    const [a, b] = timeArgs(t);
    const [q, m] = await Promise.allSettled([
      call(fetchFn, base, key, FIELDMAP.quotaPath),
      call(fetchFn, base, key, `${FIELDMAP.modelPath}?startTime=${encodeURIComponent(a)}&endTime=${encodeURIComponent(b)}`),
    ]).then((rs) => rs.map((r) => (r.status === 'fulfilled' ? r.value : { error: 'network', body: null })));

    const g = prev ? { ...emptyGlm(), ...prev } : emptyGlm();
    g.updatedAt = t;
    const quota = q.error ? null : parseQuota(q.body);
    if (quota) {
      g.fetchedAt = t; g.source = 'zai'; g.error = null;
      g.h5 = quota.h5; g.wk = quota.wk; g.used = quota.used; g.limit = quota.limit;
    } else if (!q.error) {            // 200 but unknown shape: h5/wk go null (n/a), never 0
      g.error = 'shape'; g.source = 'local';
      g.h5 = { usedPct: null, resetsAt: null }; g.wk = { usedPct: null, resetsAt: null }; g.used = null; g.limit = null;
    } else {                          // keep last good numbers
      g.error = q.error; g.source = g.fetchedAt ? 'zai' : 'local';
    }
    if (!m.error) { const ms = parseModels(m.body); if (ms) g.models = ms; }
    g.usedPct = g.h5.usedPct; g.resetsAt = g.h5.resetsAt;

    const out = { updatedAt: g.updatedAt, fetchedAt: g.fetchedAt, source: g.source, usedPct: g.usedPct, used: g.used,
      limit: g.limit, resetsAt: g.resetsAt, h5: g.h5, wk: g.wk, models: cleanModels(g.models), error: g.error };
    const tmp = file + '.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return { wrote: true, error: out.error, h5: out.h5, wk: out.wk, models: out.models.length, quotaError: q.error, modelError: m.error };
  } catch { return { skipped: 'exception' }; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const once = process.argv.includes('--once');
  const r = await refreshGlm({ force: once });
  if (once) {
    const f = (w) => (w && w.usedPct !== null ? `${w.usedPct}%` : 'n/a');
    console.log(r.skipped ? `glm: skipped (${r.skipped})`
      : `glm: error=${r.error || 'none'} 5h=${f(r.h5)} week=${f(r.wk)} models=${r.models} quota=${r.quotaError || 'ok'} model-usage=${r.modelError || 'ok'}`);
  }
  process.exit(0);
}
