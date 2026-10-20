#!/usr/bin/env node
// Office registry updater. Called by Claude Code hooks (payload on stdin) and by hand:
//   office-hook.mjs <session-start|session-end|prompt|stop|pre-agent|skill|subagent-start|subagent-stop>
//   office-hook.mjs fail "<Trainer name>" "<reason>"
// Must never block Claude: prints nothing (except `fail`), always exits 0.
// Slow work (transcript token counts, library.json) runs in a detached office-usage.mjs child,
// which replaces the pusher spawn on stop/subagent-stop/session-start: one spawn per hook call.
// A glm-run session (HQ_PROVIDER=glm) is a GLM worker at its own desk (Bill first, then the next
// reserved name): it never touches the sign or the orchestrator — the sign always shows the Claude
// session — and never hires Claude trainers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OFFICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HQ = path.dirname(OFFICE);
const STATE = path.join(OFFICE, 'state.json');
const EVENTS = path.join(OFFICE, 'events.jsonl');
const DEBUG = path.join(OFFICE, 'hook-debug.jsonl');
const DEBUG_MAX = 1024 * 1024; // past this, rotate to hook-debug.1.jsonl (SEC-010)
const LOCK = path.join(OFFICE, '.lock');
const TASKS = path.join(OFFICE, 'tasks.json');
const TASKS_LOCK = path.join(OFFICE, '.tasks.lock'); // shared with office-usage.mjs recordTask
const MAX_TASKS = 200;                               // same cap as office-usage.mjs
const NAMES = JSON.parse(fs.readFileSync(path.join(OFFICE, 'names.json'), 'utf8'));
const STALE_MS = 3 * 60 * 60 * 1000; // a "working" agent older than this missed its stop hook
const GLM_STALE_MS = 2 * 60 * 60 * 1000; // a working GLM desk older than this missed its run's stop
const HISTORY = 20;
const PROVIDER = process.env.HQ_PROVIDER === 'glm' ? 'GLM' : 'Claude';
const GLM = PROVIDER === 'GLM'; // this hook call comes from a glm-run session
const LIMIT_RE = /hit your .*limit.*?·\s*resets\s+(.+)$/im; // the usage-limit reply; one place only
// Transcripts are only ever read from here (the usage child re-checks the realpath).
const CLAUDE_DIR = (process.env.AGENT_HQ_TEST === '1' && process.env.AGENT_HQ_CLAUDE_DIR) ||
  path.join(os.homedir(), '.claude');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const clip = (s, n = 90) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const CAPS = new Set(['survey', 'build', 'verify', 'security', 'record', 'chores', 'runbook']);
const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function readStdin() {
  if (process.stdin.isTTY) return {};
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function withLock(dir, fn) {
  for (let i = 0; i < 100; i++) {
    try { fs.mkdirSync(dir); break; } catch {
      try { if (Date.now() - fs.statSync(dir).mtimeMs > 5000) fs.rmSync(dir, { recursive: true }); } catch {}
      sleep(30);
    }
  }
  try { return fn(); } finally { try { fs.rmSync(dir, { recursive: true }); } catch {} }
}

function load() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {
    const s = {
      orchestrator: { name: NAMES.orchestrator, status: 'sleeping', task: '', since: Date.now(),
                      stats: { prompts: 0, workMs: 0 } },
      agents: [], pending: {}, live: {}, updatedAt: Date.now(),
    };
    if (!GLM) for (const type of ['worker', 'reviewer']) hire(s, type); // founding team (never from a GLM run)
    return s;
  }
}

function saveJson(file, data) {
  const tmp = file + '.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function save(s) {
  s.updatedAt = Date.now();
  saveJson(STATE, s);
}

// Gate for any detached child: only when ~/.config/agent-hq/config.json exists (AGENT_HQ_CONFIG_DIR
// overrides the dir, for tests) and AGENT_HQ_PUSH !== '0'.
function pushEnabled() {
  if (process.env.AGENT_HQ_PUSH === '0') return false;
  const dir = process.env.AGENT_HQ_CONFIG_DIR || path.join(os.homedir(), '.config', 'agent-hq');
  return fs.existsSync(path.join(dir, 'config.json'));
}

function detach(script, args = []) {
  spawn(process.execPath, [path.join(OFFICE, 'bin', script), ...args], { detached: true, stdio: 'ignore' }).unref();
}

// Mirror to Firebase in a detached child (office-push.mjs) so the network never slows the hook.
function push() {
  try { if (pushEnabled()) detach('office-push.mjs'); } catch {}
}

// Hand slow work to office-usage.mjs (it spawns the pusher itself when done, same gate).
// Falls back to push() when there is nothing for it to do.
function usageOrPush(job) {
  try {
    if (job.transcript && !okTranscript(job.transcript)) delete job.transcript;
    if (job.transcript || job.sign || job.task || libraryStale() || glmDue()) return detach('office-usage.mjs', [JSON.stringify(job)]);
  } catch {}
  push();
}

// Z.ai quota fetch is due: key present and the throttle stamp (written by office-glm.mjs) older than 10 min.
// One env check + one stat; the key itself is never read here beyond presence.
function glmDue() {
  if (!process.env.ZAI_API_KEY) return false;
  try { return Date.now() - fs.statSync(path.join(OFFICE, '.glm-fetch')).mtimeMs > 10 * 60000; } catch { return true; }
}

const okTranscript = (p) => typeof p === 'string' && path.isAbsolute(p) && p.endsWith('.jsonl') &&
  p.startsWith(CLAUDE_DIR + path.sep);

// library.json is stale when any source is newer than it. Cheap: four stat calls.
function libraryStale() {
  const m = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const src = Math.max(m(path.join(HQ, 'SECURITY.md')), m(path.join(HQ, 'SECURITY-archive.md')), m(path.join(HQ, 'LESSONS.md')), m(path.join(OFFICE, 'projects.json')));
  return src > 0 && src > m(path.join(OFFICE, 'library.json'));
}

function event(e) { fs.appendFileSync(EVENTS, JSON.stringify({ ts: Date.now(), ...e }) + '\n'); }

// Ids survive desk removal (a temp GLM desk), so never reuse one: max existing number + 1.
const nextId = (s) => 'a' + (s.agents.reduce((m, a) => Math.max(m, Number(String(a?.id || '').slice(1)) || 0), 0) + 1);

function nextName(s, type) {
  const pool = NAMES.pools[type] || NAMES.pools['*'];
  const taken = new Set(s.agents.map((a) => a.name));
  for (let round = 1; ; round++) {
    for (const base of pool) {
      const name = round === 1 ? base : `${base} ${ROMAN[round] || round}`;
      if (!taken.has(name)) return name;
    }
  }
}

function hire(s, type) {
  const sameType = s.agents.filter((a) => a.type === type);
  const a = {
    id: `a${s.agents.length + 1}`, name: nextName(s, type), type,
    cloneOf: sameType.length ? sameType[0].name : null,
    status: 'sleeping', task: '', since: Date.now(), hiredAt: Date.now(),
    stats: { tasks: 0, workMs: 0, fails: 0 }, history: [],
  };
  s.agents.push(a);
  event({ kind: 'hire', agent: a.name, type, cloneOf: a.cloneOf });
  return a;
}

function finish(s, a, note) {
  const now = Date.now();
  const project = a.project || null;
  a.stats.tasks += 1;
  a.stats.workMs += now - a.since;
  const h = { task: a.task, start: a.since, end: now, project, ...(note ? { note } : {}) };
  a.history.unshift(h);
  a.history = a.history.slice(0, HISTORY);
  event({ kind: 'done', agent: a.name, task: a.task, ms: now - a.since, ...(project ? { project } : {}) });
  a.status = 'sleeping'; a.task = ''; a.since = now; a.project = null; a.skill = null;
  return h;
}

function reapStale(s) {
  const now = Date.now();
  const retiring = [];
  for (const a of s.agents) {
    if (a.status !== 'working') continue;
    if (now - a.since <= (a.type === 'glm-worker' ? GLM_STALE_MS : STALE_MS)) continue;
    finish(s, a, 'stale: no stop signal');
    if (a.type === 'glm-worker') retiring.push(a); // a crashed temp desk is removed too
  }
  for (const a of retiring) glmRetire(s, a);
  for (const [id, aid] of Object.entries(s.live)) {
    if (!s.agents.find((a) => a.id === aid && a.status === 'working')) delete s.live[id];
  }
  for (const [id, aid] of Object.entries(s.glmLive || {})) {
    if (!s.agents.find((a) => a.id === aid && a.status === 'working')) delete s.glmLive[id];
  }
  for (const t of Object.keys(s.pending)) {
    s.pending[t] = s.pending[t].filter((p) => now - p.ts < 10 * 60 * 1000);
    if (!s.pending[t].length) delete s.pending[t];
  }
}

// --- GLM desks (plan 2026-10-19-office-glm-phase §Office) ----------------------------------------
// One glm-run session = one dedicated desk from the reserved `glm` pool in names.json: Bill is
// first and permanent (sleeping between runs); a concurrent live session takes the next free
// name, and that desk is removed when its run ends. GLM events touch only their own desk.

const glmPool = () => (Array.isArray(NAMES.pools?.glm) ? NAMES.pools.glm : []);

// Desk caption from the env glm-run exports: the brief's first line (minus "# Brief:", max 60),
// else the slug; plus the brief's project tag so the matching book glows.
function glmBrief() {
  const slug = typeof process.env.HQ_GLM_SLUG === 'string' ? clip(process.env.HQ_GLM_SLUG, 60) : '';
  let title = '', project = null;
  const brief = process.env.HQ_GLM_BRIEF;
  if (typeof brief === 'string' && path.isAbsolute(brief)) {
    try {
      const head = fs.readFileSync(brief, 'utf8').split('\n', 6);
      title = clip((head[0] || '').replace(/^#\s*brief:\s*/i, ''), 60);
      const m = /^project:\s*([a-z0-9-]{1,40})/im.exec(head.slice(1, 5).join('\n'));
      if (m) project = m[1];
    } catch {}
  }
  return { title: title || slug || 'GLM run', project, slug: slug || null };
}

function glmHire(s, name) {
  const a = { id: nextId(s), name, type: 'glm-worker', cloneOf: null,
    status: 'sleeping', task: '', since: Date.now(), hiredAt: Date.now(),
    stats: { tasks: 0, workMs: 0, fails: 0 }, history: [] };
  s.agents.push(a);
  event({ kind: 'hire', agent: name, type: 'glm-worker' });
  return a;
}

// Find this session's desk, or claim the first pool name whose desk is free or missing.
function glmDeskFor(s, sid) {
  s.glmLive ||= {};
  const mine = s.agents.find((a) => a.id === s.glmLive[sid] && a.type === 'glm-worker');
  if (mine) return mine;
  let a = null;
  for (const name of glmPool()) {
    const d = s.agents.find((x) => x.type === 'glm-worker' && x.name === name);
    if (!d) { a = glmHire(s, name); break; }      // next free name: a new desk
    if (d.status !== 'working') { a = d; break; } // free again (in practice only Bill)
  }
  if (a) s.glmLive[sid] = a.id;
  return a;                                       // null: every desk is live (5+ concurrent runs)
}

function glmStart(s, sid) {
  const b = glmBrief();
  const a = glmDeskFor(s, sid);
  if (!a) return;
  const fresh = a.status !== 'working';
  a.status = 'working'; a.task = b.title; a.project = b.project; a.skill = null;
  if (fresh) { a.since = Date.now(); event({ kind: 'start', agent: a.name, task: b.title, ...(b.project ? { project: b.project } : {}) }); }
}

// Temp desks disappear when their run ends; their stats live on in the events feed and
// tasks.json, the way alumni keep theirs after retiring.
function glmRetire(s, a) {
  if (a.name === glmPool()[0]) return;            // Bill's desk is permanent
  s.agents = s.agents.filter((x) => x !== a);
  for (const k of Object.keys(s.glmLive || {})) if (s.glmLive[k] === a.id) delete s.glmLive[k];
}

// One tasks.json entry per GLM run, written here (the usage child only records Claude subagents).
// Token counts are unknown to the hook, so they stay null, never 0.
function glmTask(a, sid, h, b) {
  const entry = { id: sid || a.id, project: h.project, provider: PROVIDER, brief: b.slug,
    sessionId: sid || null, agent: a.name, startedAt: h.start, endedAt: h.end,
    tokens: { in: null, out: null, cacheRead: null, cacheWrite: null },
    contexts: 1, rework: null, verified: null };
  withLock(TASKS_LOCK, () => {
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(TASKS, 'utf8')); } catch {}
    const list = (Array.isArray(prev.tasks) ? prev.tasks : []).filter((x) => x && x.id !== entry.id);
    list.push(entry);
    saveJson(TASKS, { updatedAt: Date.now(), tasks: list.slice(-MAX_TASKS) });
  });
}

function glmStop(s, sid) {
  s.glmLive ||= {};
  const a = s.agents.find((x) => x.id === s.glmLive[sid] && x.type === 'glm-worker');
  delete s.glmLive[sid];
  if (!a || a.status !== 'working') return;       // a repeated stop (session-end after stop) is a no-op
  const h = finish(s, a);                         // +1 task, history entry, 'done' event, sleeping
  glmTask(a, sid, h, glmBrief());
  glmRetire(s, a);
}

// Only the session lifecycle matters; pre-agent/skill/subagent-* are ignored (a GLM run
// launches no agents), so a GLM event can never create a Claude desk or touch the sign.
const glmHandlers = {
  'session-start': glmStart, prompt: glmStart, stop: glmStop, 'session-end': glmStop,
};

// --- OPEN/CLOSED sign -------------------------------------------------------------------------
function sign(s) {
  s.sign ||= { open: true, provider: PROVIDER, since: Date.now() };
  s.sign.provider = PROVIDER;
  return s.sign;
}

function reopen(s) {
  s.sign = { open: true, provider: PROVIDER, since: Date.now() };
  event({ kind: 'open', provider: PROVIDER });
}

// "[cart bridge] fix login" -> { desc: 'fix login', project: 'cartbridge' } via projects.json.
function projectTag(desc) {
  const m = /^\s*\[([^\]]{1,40})\]\s*/.exec(desc);
  if (!m) return { desc, project: null };
  const tag = m[1].replace(/\s+/g, ' ').trim().toLowerCase();
  let projects = [];
  try { projects = JSON.parse(fs.readFileSync(path.join(OFFICE, 'projects.json'), 'utf8')).projects || []; } catch {}
  const norm = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().toLowerCase() : '');
  const hit = projects.find((p) => p && typeof p.slug === 'string' &&
    [p.slug, p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])].some((k) => norm(k) === tag));
  return hit ? { desc: desc.slice(m[0].length), project: hit.slug } : { desc, project: null };
}

let job = null; // set by stop/subagent-stop/session-start: work for the usage child

const handlers = {
  'session-start'(s) { reapStale(s); sign(s); job = {}; },

  // Subagents still running when the session ends were killed without a SubagentStop.
  'session-end'(s) {
    const now = Date.now();
    for (const a of s.agents.filter((x) => x.status === 'working')) {
      a.history.unshift({ task: a.task, start: a.since, end: now, project: a.project || null, note: 'interrupted: session ended' });
      a.history = a.history.slice(0, HISTORY);
      event({ kind: 'interrupted', agent: a.name, task: a.task });
      a.status = 'sleeping'; a.task = ''; a.since = now; a.project = null; a.skill = null;
    }
    s.live = {}; s.pending = {};
    handlers.stop(s);
  },

  prompt(s, p) {
    const g = sign(s);
    if (!g.open && (PROVIDER !== g.closedProvider || g.reopensAt == null || Date.now() >= g.reopensAt - 60000)) reopen(s);
    const o = s.orchestrator;
    if (o.status === 'working') o.stats.workMs += Date.now() - o.since;
    o.status = 'working'; o.since = Date.now();
    if ((p.prompt || '').trimStart().startsWith('<task-notification>')) { // a trainer reporting back, not the owner
      o.task = "Reviewing a trainer's report";
      return;
    }
    o.task = clip(p.prompt, 120) || 'Thinking…';
    o.stats.prompts += 1;
    event({ kind: 'prompt', task: o.task });
  },

  // p is undefined when session-end calls this: then the sign is left alone.
  stop(s, p) {
    const o = s.orchestrator;
    if (o.status === 'working') o.stats.workMs += Date.now() - o.since;
    o.status = 'sleeping'; o.task = ''; o.since = Date.now();
    if (!p) return;
    const g = sign(s);
    const m = LIMIT_RE.exec(typeof p.last_assistant_message === 'string' ? p.last_assistant_message : '');
    if (m) {
      const text = clip(m[0], 160);
      if (g.open || g.closedText !== text || g.closedProvider !== PROVIDER) {
        s.sign = { open: false, provider: PROVIDER, since: Date.now(), closedAt: Date.now(),
                   closedText: text, reopensAt: null, closedProvider: PROVIDER };
        event({ kind: 'closed', reason: text, provider: PROVIDER });
      }
    } else if (!g.open) reopen(s);
    job = { who: 'rowan', transcript: p.transcript_path, sign: s.sign.open === false && s.sign.reopensAt == null };
  },

  'pre-agent'(s, p) {
    const inp = p.tool_input || {};
    const type = inp.subagent_type || 'general-purpose';
    const { desc, project } = projectTag(clip(inp.description || inp.prompt, 130));
    (s.pending[type] ||= []).push({ desc: clip(desc, 90), project, ts: Date.now() });
  },

  // Worker cap: the skill a subagent is using right now. Only the 7 known skills, only when the agent resolves.
  skill(s, p) {
    if (p.tool_name !== 'Skill' || !p.agent_id) return;
    const name = typeof p.tool_input?.skill === 'string' ? p.tool_input.skill.trim() : '';
    if (!CAPS.has(name)) return;
    const a = s.agents.find((x) => x.id === s.live[p.agent_id]);
    if (a && a.status === 'working') a.skill = name;
  },

  'subagent-start'(s, p) {
    const type = p.agent_type || 'general-purpose';
    const pend = s.pending[type]?.shift();
    const desc = pend?.desc || `${type} task`;
    const project = pend?.project || null;
    // Reuse a sleeping trainer of this type; only hire another when all of them are busy.
    const a = s.agents.find((x) => x.type === type && x.status === 'sleeping') || hire(s, type);
    a.status = 'working'; a.task = desc; a.since = Date.now(); a.project = project; a.skill = null;
    if (p.agent_id) s.live[p.agent_id] = a.id;
    if (project) {
      const act = ((s.activity ||= {})[project] ||= { tasks: 0, lastAt: 0, recent: [] });
      act.tasks += 1; act.lastAt = Date.now();
      act.recent = [{ task: clip(desc, 90), agent: a.name, type, ts: Date.now() }, ...(act.recent || [])].slice(0, 5);
    }
    event({ kind: 'start', agent: a.name, task: desc, ...(project ? { project } : {}) });
  },

  'subagent-stop'(s, p) {
    let a = s.agents.find((x) => x.id === s.live[p.agent_id]);
    if (!a) a = s.agents.filter((x) => x.type === p.agent_type && x.status === 'working')
                         .sort((x, y) => x.since - y.since)[0];
    if (p.agent_id) delete s.live[p.agent_id];
    job = { who: 'agent', transcript: p.agent_transcript_path };
    if (a && a.status === 'working') {
      const h = finish(s, a);
      Object.assign(job, { aid: a.id, end: h.end,
        task: { id: p.agent_id || null, session: p.session_id || null, project: h.project, agent: a.name, startedAt: h.start } });
    }
  },
};

// SEC-010: no message text, no paths; capped at 1 MB with one rotation; mode 600.
function debugLog(cmd, p) {
  try {
    const st = fs.statSync(DEBUG);
    if (st.size > DEBUG_MAX) fs.renameSync(DEBUG, path.join(OFFICE, 'hook-debug.1.jsonl'));
    else if (st.mode & 0o077) fs.chmodSync(DEBUG, 0o600);
  } catch {}
  const ti = p.tool_input || {};
  const line = { ts: Date.now(), cmd, session_id: p.session_id, hook_event_name: p.hook_event_name,
    agent_type: p.agent_type || ti.subagent_type, agent_id: p.agent_id,
    desc: ti.description ? clip(ti.description, 90) : undefined,
    lamLen: typeof p.last_assistant_message === 'string' ? p.last_assistant_message.length : undefined };
  fs.appendFileSync(DEBUG, JSON.stringify(line) + '\n', { mode: 0o600 });
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'fail') {
    const [name, reason = ''] = args;
    const saved = withLock(LOCK, () => {
      const s = load();
      const a = s.agents.find((x) => x.name.toLowerCase() === (name || '').toLowerCase());
      if (!a) { console.error(`No trainer named "${name}". Known: ${s.agents.map((x) => x.name).join(', ')}`); return false; }
      a.stats.fails += 1;
      (a.misses ||= []).unshift({ ts: Date.now(), reason: clip(reason, 200) });
      a.misses = a.misses.slice(0, HISTORY);
      event({ kind: 'fail', agent: a.name, reason: clip(reason, 200) });
      save(s);
      console.log(`Recorded a miss for ${a.name} (${a.stats.fails} total).`);
      return true;
    });
    if (saved) push();
    return;
  }
  const handler = handlers[cmd];
  if (!handler) return;
  const payload = readStdin();
  debugLog(cmd, payload);
  if (GLM) {
    const gh = glmHandlers[cmd];
    withLock(LOCK, () => { const s = load(); if (gh) gh(s, payload.session_id || 'glm'); reapStale(s); save(s); });
    push();
    return;
  }
  withLock(LOCK, () => { const s = load(); handler(s, payload); reapStale(s); save(s); });
  if (job) usageOrPush(job); else push();
}

try { main(); } catch (e) {
  try {
    const msg = clip(String(e?.message || e).replace(/\/[^\s'"]+/g, '<path>'), 200);
    fs.appendFileSync(DEBUG, JSON.stringify({ ts: Date.now(), error: msg }) + '\n', { mode: 0o600 });
  } catch {}
}
process.exit(0);
