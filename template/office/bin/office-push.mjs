#!/usr/bin/env node
// Mirrors the office to Firebase RTDB at /office = { state, events: [last 50], pushedAt,
// projects?, library?, limits?, glm? } (plan 2026-10-17-office-v2 §3.9), and a world-readable /public
// node built by buildPublic() from an explicit whitelist (plan 2026-10-19-office-public-view).
// Both go in ONE multi-path PATCH at the root: { "office/state": .., ..., "public": {..} }.
// RTDB checks the rules per path, so /office keeps its own .write and root stays closed. projects.json, library.json
// and limits.json are optional: a missing/unparseable file just leaves its key out of the PATCH.
// They are re-shaped to the contract (known fields only, typed, length-capped) so one bad field
// can't make the rules reject the whole push; projects never carry path or securityKeys.
// Bodies over 200 KB are not sent (push-status "disabled:size").
// Importing this module (tests) only exposes buildPublic(); main() runs only when executed directly.
// Write-only: one PATCH ?print=silent per push, never a GET/read-back, so the writer needs no .read.
// Spawned detached by office-hook.mjs after every save. Node built-ins only.
// Must never matter: prints nothing, logs nothing, swallows every error, dies within 8 s.
//
// Config lives in ~/.config/agent-hq/ (read at runtime only, never copied anywhere):
//   config.json          { projectId, apiKey, databaseURL, writerUid: "office-writer",
//                          serviceAccountPath? (absolute; default below) }
//   service-account.json the no-role "office-writer" SA key (secret)
//   token.json           cached ID/refresh token, written here with mode 600 (secret)
// Refuses to run (silently) unless: the config dir and key file have no group/other bits
// (mode & 077 == 0); databaseURL is an https Firebase RTDB URL (*.firebaseio.com or
// *.<region>.firebasedatabase.app) whose host label is <projectId> or starts with <projectId>-
// (e.g. <projectId>-default-rtdb.firebaseio.com); and the key's client_email is
// <writerUid>@<projectId>.iam.gserviceaccount.com with project_id === projectId.
// Auth endpoints are hard-coded to identitytoolkit/securetoken.googleapis.com.
// Test mode needs AGENT_HQ_TEST=1 AND an AGENT_HQ_CONFIG_DIR that is not ~/.config/agent-hq,
// so it can never run against the real key. It skips the checks above so fake keys and local
// servers work:
//   config.identityToolkitBase / config.secureTokenBase  replace the Google auth endpoints
//     (e.g. "http://127.0.0.1:9099/identitytoolkit.googleapis.com" for the Auth emulator)
//   and databaseURL may be any URL. Outside test mode these overrides are ignored.
// AGENT_HQ_CONFIG_DIR uses that directory instead of ~/.config/agent-hq (mode-checked unless test mode).
// <configDir>/push-status (mode 600, no secrets) gets "disabled:<reason> <iso>" when a guard
// stops the push, or "ok <iso>" after a successful push.
// Never reads or sends hook-debug.jsonl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const OFFICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(OFFICE, 'state.json');
const EVENTS = path.join(OFFICE, 'events.jsonl');
const PROJECTS = path.join(OFFICE, 'projects.json');
const LIBRARY = path.join(OFFICE, 'library.json');
const LIMITS = path.join(OFFICE, 'limits.json');
const TASKS = path.join(OFFICE, 'tasks.json');
const LOCK = path.join(OFFICE, '.push.lock');
const DIRTY = path.join(OFFICE, '.push-dirty');
const DEFAULT_CONF_DIR = path.join(os.homedir(), '.config', 'agent-hq');
const CONF_DIR = process.env.AGENT_HQ_CONFIG_DIR || DEFAULT_CONF_DIR;
const TOKEN = path.join(CONF_DIR, 'token.json');
const STATUS = path.join(CONF_DIR, 'push-status');
const REQ_MS = 2500;      // per HTTP request
const HARD_MS = 8000;     // whole process
const STALE_LOCK_MS = 15000;
const MAX_LOOPS = 5;
const MAX_EVENTS = 50;    // rules reject events/50
const TAIL_BYTES = 64 * 1024;
const MAX_BODY = 200 * 1024; // bytes; larger snapshots are skipped, not truncated
const MAX_PROJECTS = 40;  // rules accept projects/0..39
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const TEST = process.env.AGENT_HQ_TEST === '1' && !!process.env.AGENT_HQ_CONFIG_DIR &&
  real(process.env.AGENT_HQ_CONFIG_DIR) !== real(DEFAULT_CONF_DIR);
const ID_BASE = 'https://identitytoolkit.googleapis.com';
const TOKEN_BASE = 'https://securetoken.googleapis.com';
const DB_URL_RE = /^https:\/\/[a-z0-9-]+\.(firebaseio\.com|[a-z0-9-]+\.firebasedatabase\.app)\/?$/;
const T0 = Date.now();

const IS_MAIN = (() => { try { return real(process.argv[1]) === real(fileURLToPath(import.meta.url)); } catch { return false; } })();
let ownLock = false;
const unlock = () => { if (ownLock) { ownLock = false; try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} } };
if (IS_MAIN) {
  process.on('exit', unlock);
  setTimeout(() => process.exit(0), HARD_MS).unref();
}

function lock() {
  for (let i = 0; i < 2; i++) {
    try { fs.mkdirSync(LOCK); ownLock = true; return true; } catch {}
    try { if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_LOCK_MS) { fs.rmSync(LOCK, { recursive: true, force: true }); continue; } } catch { continue; }
    break;
  }
  try { fs.writeFileSync(DIRTY, ''); } catch {} // holder will push again for us
  return false;
}

function lastEvents() {
  let fd;
  try {
    fd = fs.openSync(EVENTS, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let lines = buf.toString('utf8').split('\n');
    if (start > 0) lines = lines.slice(1); // first line is probably cut in half
    const out = [];
    for (const l of lines) { if (l.trim()) { try { out.push(JSON.parse(l)); } catch {} } }
    const evs = out.slice(-MAX_EVENTS);
    for (const e of evs) if (e && typeof e === 'object') delete e.cloneOf; // never shown, never pushed
    return evs;
  } catch { return []; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// --- optional side files, re-shaped to the data contract (§3.5-3.7). undefined = leave the key out.
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return undefined; } };
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const strs = (a, max, n) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, max).map((x) => x.slice(0, n)) : undefined);
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const SEC_RE = /^SEC-[0-9]{3,4}$/;
const GROUPS = new Set(['active', 'maintained', 'dormant']);
const SEVS = new Set(['low', 'medium', 'high', 'critical']);
const PROVIDERS = new Set(['Claude', 'GLM']);

function projects() {
  const list = readJson(PROJECTS)?.projects;
  if (!Array.isArray(list)) return undefined;
  return list.filter((p) => p && SLUG_RE.test(p.slug) && typeof p.name === 'string' && GROUPS.has(p.group))
    .slice(0, MAX_PROJECTS).map((p) => ({ // whitelist: path and securityKeys are local-only
      slug: p.slug, name: p.name.slice(0, 40), aliases: strs(p.aliases, 10, 40),
      description: str(p.description, 160), stack: strs(p.stack, 8, 30), stackColorKey: str(p.stackColorKey, 20),
      repo: str(p.repo, 120), hosting: str(p.hosting, 120), status: str(p.status, 60),
      group: p.group, owned: bool(p.owned),
    }));
}

function library() {
  const l = readJson(LIBRARY);
  if (!l || typeof l !== 'object') return undefined;
  const security = {}, lessons = {};
  for (const [slug, v] of Object.entries(obj(l.security)).slice(0, 60)) {
    if (!SLUG_RE.test(slug) || !v || typeof v !== 'object') continue;
    const items = Array.isArray(v.items)
      ? v.items.filter((i) => i && SEC_RE.test(i.id) && SEVS.has(i.sev)).slice(0, 10).map((i) => ({ id: i.id, sev: i.sev }))
      : undefined;
    security[slug] = { open: num(v.open), critical: bool(v.critical), items };
  }
  for (const [slug, n] of Object.entries(obj(l.lessons)).slice(0, 60)) if (SLUG_RE.test(slug) && num(n) !== undefined) lessons[slug] = n;
  const src = obj(l.src);
  return { generatedAt: num(l.generatedAt), src: { securityMtime: num(src.securityMtime), lessonsMtime: num(src.lessonsMtime) },
           security, lessons };
}

// Last 50 tasks from tasks.json (owner-only, under /office). Typed and capped; unknown stays null.
const MAX_TASKS = 50;
function tasks() {
  const l = readJson(TASKS);
  if (!l || typeof l !== "object" || !Array.isArray(l.tasks)) return undefined;
  const n = (v) => (num(v) === undefined ? null : v);
  const out = l.tasks.filter((x) => x && typeof x === "object" && typeof x.id === "string").slice(-MAX_TASKS).map((x) => {
    const t = obj(x.tokens);
    return { id: x.id.slice(0, 80), project: str(x.project, 40) ?? null, provider: PROVIDERS.has(x.provider) ? x.provider : null,
      sessionId: str(x.sessionId, 80) ?? null, agent: str(x.agent, 40) ?? null, startedAt: n(x.startedAt), endedAt: n(x.endedAt),
      tokens: { in: n(t.in), out: n(t.out), cacheRead: n(t.cacheRead), cacheWrite: n(t.cacheWrite) },
      contexts: n(x.contexts), rework: n(x.rework), verified: bool(x.verified) ?? null };
  });
  return { updatedAt: num(l.updatedAt), tasks: out };
}

// glm.json (written only by office-glm.mjs): whitelist, null/invalid -> key dropped (JSON.stringify drops undefined).
const GLM_ERRORS = new Set(['unauthorized', 'quota', 'network', 'shape']);
function glm() {
  const l = readJson(path.join(OFFICE, 'glm.json'));
  if (!l || typeof l !== 'object') return undefined;
  const pct = (v) => (num(v) === undefined ? undefined : Math.min(100, Math.max(0, v)));
  const win = (w) => (w && typeof w === 'object' ? { usedPct: pct(w.usedPct), resetsAt: num(w.resetsAt) } : undefined);
  const models = Array.isArray(l.models)
    ? l.models.filter((m) => m && typeof m.name === 'string' && num(m.tokens) !== undefined).slice(0, 6)
        .map((m) => ({ name: m.name.slice(0, 40), tokens: m.tokens }))
    : undefined;
  return { updatedAt: num(l.updatedAt), fetchedAt: num(l.fetchedAt), source: l.source === 'zai' ? 'zai' : l.source === 'local' ? 'local' : undefined,
           usedPct: pct(l.usedPct), used: num(l.used), limit: num(l.limit), resetsAt: num(l.resetsAt),
           h5: win(l.h5), wk: win(l.wk), models, error: GLM_ERRORS.has(l.error) ? l.error : undefined };
}

function limits() {
  const l = readJson(LIMITS);
  if (!l || typeof l !== 'object') return undefined;
  const win = (w) => (w && typeof w === 'object'
    ? { usedPct: num(w.usedPct) === undefined ? undefined : Math.min(100, Math.max(0, w.usedPct)), resetsAt: num(w.resetsAt) }
    : undefined);
  return { updatedAt: num(l.updatedAt), provider: PROVIDERS.has(l.provider) ? l.provider : undefined,
           model: str(l.model, 60), fiveHour: win(l.fiveHour), sevenDay: win(l.sevenDay) };
}

// --- /public (plan 2026-10-19-office-public-view, "/public schema"). Pure: no I/O, no clock.
// Every field is picked by name and typed/capped to the rules; nothing is copied wholesale.
// Never carries task text, history, project per agent, tokens, usage, sign details, descriptions,
// repo, hosting, SEC data. D1 (owner, 2026-10-19): every project name is public, so books are
// keyed by slug and always have a title and working flag.
// Same formula as office/site/index.html line ~143: `const level = (tasks) => 1 + Math.floor(Math.sqrt(tasks * 3));`
const siteLevel = (tasks) => 1 + Math.floor(Math.sqrt(tasks * 3));
const AGENT_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PUB_STATUSES = new Set(['working', 'idle', 'sleeping', 'thinking']);
const MAX_PUBLIC = 60;
const PUB_CAPS = new Set(['survey', 'build', 'verify', 'security', 'record', 'chores', 'runbook']);
const pubStatus = (v) => (PUB_STATUSES.has(v) ? v : 'idle');
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const label = (v, n, dflt) => (typeof v === 'string' && v ? v.slice(0, n) : dflt);

export function buildPublic(state, projectsFile, pushedAt) {
  const s = obj(state);
  const agents = Object.create(null), books = Object.create(null); // null-proto: an id like __proto__ stays a plain key
  const orch = obj(s.orchestrator);
  const list = Array.isArray(s.agents) ? s.agents : [];
  const working = new Set();
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    if (a.status === 'working' && typeof a.project === 'string') working.add(a.project); // same test as library.js glow
    if (Object.keys(agents).length >= MAX_PUBLIC || typeof a.id !== 'string' || !AGENT_KEY_RE.test(a.id) || Object.hasOwn(agents, a.id)) continue;
    const tasks = count(obj(a.stats).tasks);
    agents[a.id] = { name: label(a.name, 40, a.id), type: label(a.type, 20, 'trainer'), status: pubStatus(a.status),
                     level: Math.min(999, siteLevel(tasks)), tasks,
                     cap: PUB_CAPS.has(a.skill) && a.status === 'working' ? a.skill : '' };
  }
  const plist = Array.isArray(obj(projectsFile).projects) ? projectsFile.projects : [];
  plist.forEach((p, i) => {
    if (i > 99 || Object.keys(books).length >= MAX_PUBLIC) return;
    if (!p || !SLUG_RE.test(p.slug) || typeof p.name !== 'string' || !GROUPS.has(p.group) || Object.hasOwn(books, p.slug)) return;
    books[p.slug] = { title: label(p.name, 40, p.slug), color: i % 16, shelf: p.group, working: working.has(p.slug), order: i };
  });
  return {
    pushedAt: count(pushedAt),
    sign: { open: obj(s.sign).open !== false }, // same default as the site: only an explicit false is CLOSED
    orchestrator: { name: label(orch.name, 40, 'Prof. Rowan'), status: pubStatus(orch.status) },
    agents, books,
  };
}

function snapshot() {
  const s = JSON.parse(fs.readFileSync(STATE, 'utf8')); // written atomically by rename
  const pushedAt = Date.now();
  const pub = buildPublic(s, readJson(PROJECTS), pushedAt); // from the untouched state, before we trim it
  delete s.pending; delete s.live; delete s.glmLive; // internal bookkeeping, not for the page
  // JSON.stringify drops undefined keys, so a missing side file is simply not in the PATCH.
  const office = { state: s, events: lastEvents(), pushedAt, projects: projects(), library: library(), limits: limits(), glm: glm(), tasks: tasks() };
  // Multi-path root update: "office/<key>" replaces only that child (same as PATCH /office today);
  // "public" replaces the whole public node, so retired agents/books disappear.
  const body = { public: pub };
  for (const [k, v] of Object.entries(office)) if (v !== undefined) body[`office/${k}`] = v;
  return body;
}

async function http(url, opts) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(REQ_MS) });
  let body = null;
  try { body = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, body };
}

const b64u = (b) => Buffer.from(b).toString('base64url');

function customToken(sa, uid) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email, uid, iat: now, exp: now + 3600,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
  }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), sa.private_key);
  return `${head}.${claims}.${b64u(sig)}`;
}

function saveToken(t) {
  const tmp = `${TOKEN}.${process.pid}.tmp`;
  fs.rmSync(tmp, { force: true }); // stale leftover from a crashed run with a recycled pid
  fs.writeFileSync(tmp, JSON.stringify(t), { mode: 0o600, flag: 'wx' }); // fails rather than follow/reuse a file
  fs.renameSync(tmp, TOKEN);
}

function readToken() { try { return JSON.parse(fs.readFileSync(TOKEN, 'utf8')); } catch { return null; } }

const keyPath = (cfg) => cfg.serviceAccountPath || path.join(CONF_DIR, 'service-account.json');
const readKey = (cfg) => JSON.parse(fs.readFileSync(keyPath(cfg), 'utf8'));

// One short line, no secrets. Never throws, never prints.
function status(line) {
  const tmp = `${STATUS}.${process.pid}.tmp`;
  try {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, `${line} ${new Date().toISOString()}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, STATUS);
  } catch { try { fs.rmSync(tmp, { force: true }); } catch {} }
}

// Production guards (see header). Returns '' when OK, else a short reason that makes main() exit silently.
function untrusted(cfg) {
  if (TEST) return '';
  const pid = String(cfg.projectId || '');
  if (!pid) return 'project';
  const url = String(cfg.databaseURL);
  if (!DB_URL_RE.test(url)) return 'url';
  const label = new URL(url).hostname.split('.')[0];
  if (label !== pid && !label.startsWith(`${pid}-`)) return 'url';
  try {
    if ((fs.statSync(CONF_DIR).mode & 0o077) || (fs.statSync(keyPath(cfg)).mode & 0o077)) return 'mode';
  } catch { return 'key'; }
  let sa;
  try { sa = readKey(cfg); } catch { return 'key'; }
  if (sa.project_id !== pid ||
      sa.client_email !== `${cfg.writerUid || 'office-writer'}@${pid}.iam.gserviceaccount.com`) return 'email';
  return '';
}

async function mint(cfg) {
  const sa = readKey(cfg);
  const base = (TEST && cfg.identityToolkitBase) || ID_BASE;
  const r = await http(`${base}/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken(sa, cfg.writerUid || 'office-writer'), returnSecureToken: true }),
  });
  if (!r.ok || !r.body?.idToken) throw new Error('mint');
  const t = { idToken: r.body.idToken, refreshToken: r.body.refreshToken,
              expiresAt: Date.now() + (Number(r.body.expiresIn) || 3600) * 1000 };
  saveToken(t);
  return t;
}

async function refresh(cfg, old) {
  const base = (TEST && cfg.secureTokenBase) || TOKEN_BASE;
  const r = await http(`${base}/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: old.refreshToken }).toString(),
  });
  if (!r.ok || !r.body?.id_token) throw new Error('refresh');
  const t = { idToken: r.body.id_token, refreshToken: r.body.refresh_token || old.refreshToken,
              expiresAt: Date.now() + (Number(r.body.expires_in) || 3600) * 1000 };
  saveToken(t);
  return t;
}

// Returns { tok, cached }: cached = true when no auth request was made (token.json was still fresh).
async function idToken(cfg, forceNew) {
  const t = forceNew ? null : readToken();
  if (t?.idToken && t.expiresAt - Date.now() > 60000) return { tok: t.idToken, cached: true }; // the usual case
  if (t?.refreshToken) { try { return { tok: (await refresh(cfg, t)).idToken, cached: false }; } catch {} }
  return { tok: (await mint(cfg)).idToken, cached: false };
}

async function pushOnce(cfg) {
  const body = JSON.stringify(snapshot());
  if (Buffer.byteLength(body) > MAX_BODY) { status('disabled:size'); return false; }
  const db = String(cfg.databaseURL).replace(/\/+$/, '');
  const send = async (tok) => http(`${db}/.json?print=silent&auth=${encodeURIComponent(tok)}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body });
  const first = await idToken(cfg, false);
  let r = await send(first.tok);
  // Only a cached token can have gone bad behind our back; a fresh one failing means rules/config, so stop.
  if ((r.status === 401 || r.status === 403) && first.cached) r = await send((await idToken(cfg, true)).tok);
  return r.ok;
}

const timeLeft = () => HARD_MS - (Date.now() - T0) > 2 * REQ_MS;

async function main() {
  if (process.env.AGENT_HQ_PUSH === '0') return;
  const cfg = JSON.parse(fs.readFileSync(path.join(CONF_DIR, 'config.json'), 'utf8'));
  if (!cfg.databaseURL) return status('disabled:url');
  if (!cfg.apiKey) return status('disabled:apikey');
  const why = untrusted(cfg);
  if (why) return status(`disabled:${why}`);
  let loops = 0;
  while (lock()) {
    do {
      try { fs.rmSync(DIRTY, { force: true }); } catch {}
      try { if (await pushOnce(cfg)) status('ok'); } catch {}
      loops++;
    } while (fs.existsSync(DIRTY) && loops < MAX_LOOPS && timeLeft());
    unlock();
    // A run that marked dirty between our last check and unlock() saw the lock held and left;
    // take the lock back and push again so that update isn't lost.
    if (!fs.existsSync(DIRTY) || loops >= MAX_LOOPS || !timeLeft()) break;
  }
}

if (IS_MAIN) main().catch(() => {}).finally(() => { unlock(); process.exit(0); });
