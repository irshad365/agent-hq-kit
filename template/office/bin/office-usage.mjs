#!/usr/bin/env node
// Office usage child. Spawned detached by office-hook.mjs on stop / subagent-stop / session-start:
//   office-usage.mjs '<job json>'   job = { who?: 'rowan'|'agent', transcript?, aid?, end?, sign? }
// 1. Counts new tokens in a transcript (byte cursor + message.id dedupe), outside any lock.
// 2. Rebuilds library.json from SECURITY.md / LESSONS.md / projects.json when they changed.
// 3. Takes office/.lock only to load, add deltas (and parse sign.reopensAt), and save state.json.
// 4. Refreshes glm.json from the Z.ai monitor API (office-glm.mjs; throttled, skipped without ZAI_API_KEY).
// 5. Always spawns the pusher afterwards (same gate as the hook), since it replaced the hook's push. Prints nothing, swallows every error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OFFICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HQ = path.dirname(OFFICE);
const STATE = path.join(OFFICE, 'state.json');
const EVENTS = path.join(OFFICE, 'events.jsonl');
const LOCK = path.join(OFFICE, '.lock');
const CURSORS = path.join(OFFICE, '.usage-cursors.json');
const ULOCK = path.join(OFFICE, '.usage.lock');
const LIBRARY = path.join(OFFICE, 'library.json');
const SECURITY = path.join(HQ, 'SECURITY.md');
const SECURITY_ARCHIVE = path.join(HQ, 'SECURITY-archive.md'); // same format; fixed/dismissed items moved here
const LESSONS = path.join(HQ, 'LESSONS.md');
const PROJECTS = path.join(OFFICE, 'projects.json');
const TASKS = path.join(OFFICE, 'tasks.json');
const TLOCK = path.join(OFFICE, '.tasks.lock');
const MAX_TASKS = 200;
const PROVIDER = process.env.HQ_PROVIDER === 'glm' ? 'GLM' : 'Claude';
const CLAUDE_DIR = (process.env.AGENT_HQ_TEST === '1' && process.env.AGENT_HQ_CLAUDE_DIR) ||
  path.join(os.homedir(), '.claude');
const MAX_READ = 20 * 1024 * 1024;
const DAY = 86400000;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const clip = (s, n = 90) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const T0 = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
const total = (t) => t.in + t.out + t.cacheRead + t.cacheWrite;
const int = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
function addT(dst, src) {
  for (const k of ['in', 'out', 'cacheRead', 'cacheWrite']) dst[k] = int(dst[k]) + src[k];
  return dst;
}
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeAtomic(f, data, mode) {
  const tmp = f + '.' + process.pid;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, f);
}

// mkdir lock: `tries` x 30 ms, stealing a lock older than 5 s (same scheme as the hook).
function withLock(dir, tries, fn) {
  for (let i = 0; i < tries; i++) {
    try { fs.mkdirSync(dir); break; } catch {
      try { if (Date.now() - fs.statSync(dir).mtimeMs > 5000) fs.rmSync(dir, { recursive: true }); } catch {}
      sleep(30);
    }
  }
  try { return fn(); } finally { try { fs.rmSync(dir, { recursive: true }); } catch {} }
}

// --- transcripts --------------------------------------------------------------------------------
function safeTranscript(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || !p.endsWith('.jsonl')) return null;
  try {
    const real = fs.realpathSync(p), root = fs.realpathSync(CLAUDE_DIR);
    return real.startsWith(root + path.sep) && real.endsWith('.jsonl') ? real : null;
  } catch { return null; }
}

// Reads complete lines after cur.offset. Returns { delta: {Claude:T, GLM:T}, msgs, offset, lastId }.
// allowSidechain: a subagent's own transcript marks every line isSidechain:true.
function scan(file, cur, allowSidechain) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    let offset = cur.offset || 0, lastId = cur.lastId || null;
    if (size < offset) { offset = 0; lastId = null; } // truncated or replaced: start again
    const delta = { Claude: T0(), GLM: T0() };
    const kinds = { in: false, out: false, cacheRead: false, cacheWrite: false };
    let msgs = 0;
    const len = Math.min(size - offset, MAX_READ);
    if (len <= 0) return { delta, msgs, offset, lastId };
    const buf = Buffer.alloc(len);
    const got = fs.readSync(fd, buf, 0, len, offset);
    const nl = buf.lastIndexOf(0x0a, got - 1);
    if (nl < 0) return { delta, msgs, offset, lastId }; // no complete line yet
    const seen = new Set(lastId ? [lastId] : []);
    for (const line of buf.toString('utf8', 0, nl).split('\n')) {
      if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const m = j && j.type === 'assistant' && j.message;
      const u = m && m.usage;
      if (!u || typeof u !== 'object') continue;
      if (j.isSidechain === true && !allowSidechain) continue;
      if (m.model === '<synthetic>') continue;
      if (typeof m.id === 'string') { if (seen.has(m.id)) continue; seen.add(m.id); lastId = m.id; }
      if (u.input_tokens != null) kinds.in = true;
      if (u.output_tokens != null) kinds.out = true;
      if (u.cache_read_input_tokens != null) kinds.cacheRead = true;
      if (u.cache_creation_input_tokens != null) kinds.cacheWrite = true;
      const prov = /^glm/i.test(m.model || '') ? 'GLM' : PROVIDER;
      addT(delta[prov], { in: int(u.input_tokens), out: int(u.output_tokens),
                          cacheRead: int(u.cache_read_input_tokens), cacheWrite: int(u.cache_creation_input_tokens) });
      msgs++;
    }
    return { delta, msgs, kinds, offset: offset + nl + 1, lastId };
  } finally { fs.closeSync(fd); }
}

function pruneCursors(c) {
  const now = Date.now();
  const keep = Object.entries(c).filter(([, v]) => v && now - (v.seenAt || 0) < 7 * DAY)
    .sort((a, b) => b[1].seenAt - a[1].seenAt).slice(0, 50);
  return Object.fromEntries(keep);
}

// --- library.json -------------------------------------------------------------------------------
const SEVS = new Set(['low', 'medium', 'high', 'critical']);

function buildLibrary() {
  const projects = (readJSON(PROJECTS, {}).projects || []).filter((p) => p && typeof p.slug === 'string');
  const keyMap = new Map();
  for (const p of projects) for (const k of p.securityKeys || []) {
    if (typeof k !== 'string') continue;
    const key = k.trim().toLowerCase();
    if (!keyMap.has(key)) keyMap.set(key, []);
    keyMap.get(key).push(p.slug);
  }
  const security = {};
  for (const secFile of [SECURITY, SECURITY_ARCHIVE]) {
  let sec = ''; try { sec = fs.readFileSync(secFile, 'utf8'); } catch {}
  let inTable = false;
  for (const raw of sec.split('\n')) {
    const line = raw.trim();
    if (!inTable) { if (/^\|\s*ID\s*\|\s*Severity\s*\|\s*Status\s*\|\s*Project\s*\|/i.test(line)) inTable = true; continue; }
    if (!line.startsWith('|')) break; // only the top table
    const cols = line.split('|').slice(1, -1).map((x) => x.trim());
    if (cols.length < 4 || !/^SEC-[0-9]{3,4}$/.test(cols[0])) continue; // separator row etc.
    const [id, sevRaw, statusRaw, projRaw] = cols;
    const status = statusRaw.toLowerCase();
    // Closed only when fixed/accepted/closed/dismissed and nothing is still awaited.
    if (/^(fixed|accepted|closed|dismissed)\b/.test(status) && !status.includes('awaiting')) continue;
    const sev = sevRaw.toLowerCase();
    if (!SEVS.has(sev)) continue;
    const slugs = new Set();
    for (const part of projRaw.split('/')) for (const s of keyMap.get(part.trim().toLowerCase()) || []) slugs.add(s);
    for (const slug of slugs) {
      const e = (security[slug] ||= { open: 0, critical: false, items: [] });
      e.open += 1;
      if (sev === 'critical') e.critical = true;
      if (e.items.length < 10) e.items.push({ id, sev });
    }
  }
  }
  const lessons = {};
  let les = ''; try { les = fs.readFileSync(LESSONS, 'utf8'); } catch {}
  const entries = les.split(/^## /m).slice(1);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const p of projects) {
    const terms = [p.slug, p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])]
      .filter((t) => typeof t === 'string' && t.trim()).map((t) => esc(t.trim()).replace(/\s+/g, '\\s+'));
    if (!terms.length) continue;
    const re = new RegExp(`(?<![A-Za-z0-9])(?:${terms.join('|')})(?![A-Za-z0-9])`, 'i');
    const n = entries.filter((e) => re.test(e)).length;
    if (n) lessons[p.slug] = n;
  }
  return { generatedAt: Date.now(), src: { securityMtime: Math.floor(Math.max(mtime(SECURITY), mtime(SECURITY_ARCHIVE))), lessonsMtime: Math.floor(mtime(LESSONS)) },
           security, lessons };
}

function libraryStale() {
  const src = Math.max(mtime(SECURITY), mtime(SECURITY_ARCHIVE), mtime(LESSONS), mtime(PROJECTS));
  return src > 0 && src > mtime(LIBRARY);
}

// --- reopensAt ------------------------------------------------------------------------------------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function zoneParts(zone, t) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const o = {}; for (const p of f.formatToParts(new Date(t))) o[p.type] = Number(p.value);
  return o;
}
const offsetAt = (zone, t) => { const p = zoneParts(zone, t); return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000; };
function wallToEpoch(zone, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo, d, h, mi);
  let t = guess - offsetAt(zone, guess);
  t = guess - offsetAt(zone, t); // second pass settles DST edges
  return t;
}

// "1:50pm (America/New_York)" / "Oct 20, 3pm (America/New_York)" -> next occurrence after `after`.
export function parseReopens(text, after) {
  const m = /resets\s+(.+)$/i.exec(text || '');
  if (!m) return null;
  const rest = m[1];
  const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(rest);
  if (!tm) return null;
  let h = Number(tm[1]) % 12; const mi = Number(tm[2] || 0);
  if (tm[3].toLowerCase() === 'pm') h += 12;
  if (h > 23 || mi > 59) return null;
  let zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zm = /\(([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*)\)/.exec(rest);
  if (zm) { try { new Intl.DateTimeFormat('en-US', { timeZone: zm[1] }); zone = zm[1]; } catch { return null; } }
  const now = zoneParts(zone, after);
  const dm = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i.exec(rest);
  if (dm) {
    const mo = MONTHS.indexOf(dm[1].toLowerCase()), d = Number(dm[2]);
    if (dm[3]) return wallToEpoch(zone, Number(dm[3]), mo, d, h, mi);
    let t = wallToEpoch(zone, now.year, mo, d, h, mi);
    if (t <= after) t = wallToEpoch(zone, now.year + 1, mo, d, h, mi);
    return t;
  }
  for (let add = 0; add < 3; add++) {
    const day = new Date(Date.UTC(now.year, now.month - 1, now.day + add));
    const t = wallToEpoch(zone, day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, mi);
    if (t > after) return t;
  }
  return null;
}

// --- merge into state.json ------------------------------------------------------------------------
function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function merge(job, res) {
  let s; try { s = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return false; } // never invent state
  let changed = false;
  if (res && res.msgs) {
    const all = addT(addT(T0(), res.delta.Claude), res.delta.GLM);
    const u = (s.usage ||= {});
    u.byProvider ||= {};
    const day = ((u.daily ||= {})[dayKey(Date.now())] ||= {});
    for (const prov of ['Claude', 'GLM']) {
      u.byProvider[prov] = addT(u.byProvider[prov] || T0(), res.delta[prov]);
      if (total(res.delta[prov])) day[prov] = int(day[prov]) + total(res.delta[prov]);
    }
    u.daily = Object.fromEntries(Object.entries(u.daily).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8));
    u.updatedAt = Date.now();
    if (job.who === 'rowan' && s.orchestrator) {
      const o = s.orchestrator;
      o.tokens = addT(o.tokens || T0(), all);
      o.tokens.turns = int(o.tokens.turns) + 1;
    }
    if (job.who === 'agent' && job.aid) {
      const a = (s.agents || []).find((x) => x.id === job.aid);
      if (a) {
        a.tokens = addT(a.tokens || T0(), all);
        const h = (a.history || []).find((x) => x.end === job.end);
        if (h) h.tokens = addT(h.tokens || T0(), all);
        fs.appendFileSync(EVENTS, JSON.stringify({ ts: Date.now(), kind: 'tokens', agent: a.name, total: total(all),
                                                   task: clip(h ? h.task : '', 90) }) + '\n');
      }
    }
    changed = true;
  }
  const g = s.sign;
  if (job.sign && g && g.open === false && g.reopensAt == null && g.closedText) {
    const t = parseReopens(g.closedText, g.closedAt || Date.now());
    if (t) { g.reopensAt = t; changed = true; }
  }
  if (!changed) return false;
  s.updatedAt = Date.now();
  writeAtomic(STATE, JSON.stringify(s, null, 2));
  return true;
}

// --- tasks.json: one entry per finished subagent run. Single writer (this file), atomic rename.
// Anything not reported is null, never 0; rework and verified stay null until something really knows them.
function recordTask(job, res) {
  const k = job.task;
  if (!k || typeof k !== "object") return;
  const end = Number.isFinite(job.end) ? job.end : Date.now();
  const id = typeof k.id === "string" && k.id ? k.id : `${job.aid || "agent"}-${end}`;
  const tok = { in: null, out: null, cacheRead: null, cacheWrite: null };
  if (res && res.msgs) {
    const all = addT(addT(T0(), res.delta.Claude), res.delta.GLM);
    for (const key of Object.keys(tok)) if (res.kinds && res.kinds[key]) tok[key] = all[key];
  }
  const entry = { id, project: typeof k.project === "string" ? k.project : null, provider: PROVIDER,
    sessionId: typeof k.session === "string" ? k.session : null, agent: typeof k.agent === "string" ? k.agent : null,
    startedAt: Number.isFinite(k.startedAt) ? k.startedAt : null, endedAt: end,
    tokens: tok, contexts: 1, rework: null, verified: null };
  withLock(TLOCK, 100, () => {
    const prev = readJSON(TASKS, {});
    const list = (Array.isArray(prev.tasks) ? prev.tasks : []).filter((x) => x && x.id !== id);
    list.push(entry);
    writeAtomic(TASKS, JSON.stringify({ updatedAt: Date.now(), tasks: list.slice(-MAX_TASKS) }, null, 2));
  });
}

function push() {
  if (process.env.AGENT_HQ_PUSH === '0') return;
  const dir = process.env.AGENT_HQ_CONFIG_DIR || path.join(os.homedir(), '.config', 'agent-hq');
  if (!fs.existsSync(path.join(dir, 'config.json'))) return;
  spawn(process.execPath, [path.join(OFFICE, 'bin', 'office-push.mjs')], { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  let job = {}; try { job = JSON.parse(process.argv[2] || '{}') || {}; } catch {}
  try { if (libraryStale()) writeAtomic(LIBRARY, JSON.stringify(buildLibrary(), null, 2)); } catch {}
  const file = safeTranscript(job.transcript);
  let taskRes = null;
  if (file) {
    // The cursor lock spans scan + merge, so two children on one transcript never count a line twice.
    withLock(ULOCK, 100, () => {
      const cursors = readJSON(CURSORS, {});
      const res = scan(file, cursors[file] || {}, job.who === 'agent');
      taskRes = res;
      withLock(LOCK, 100, () => merge(job, res));
      cursors[file] = { offset: res.offset, lastId: res.lastId, seenAt: Date.now() };
      writeAtomic(CURSORS, JSON.stringify(pruneCursors(cursors)), 0o600);
    });
  } else if (job.sign) {
    withLock(LOCK, 100, () => merge(job, null));
  }
  try { recordTask(job, taskRes); } catch {}
  // Z.ai quota -> glm.json (throttled, no-op without ZAI_API_KEY). Dynamic import: a missing/broken module never costs the token counting above.
  try { await (await import('./office-glm.mjs')).refreshGlm(); } catch {}
  push(); // the hook handed its push to us: always mirror (same gate)
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setTimeout(() => process.exit(0), 15000); // hard cap: the fetch must never hang the child
  main().catch(() => {}).finally(() => process.exit(0));
}
