#!/usr/bin/env node
// Claude Code statusLine command. Reads the statusline JSON on stdin, saves plan limits to
// office/limits.json (plan 3.6) and prints one short line, e.g. "HQ · Claude · 5h 42% · wk 18%".
// Writes only when the values change; spawns the pusher at most once every 60 s.
// Must never break the status bar: never throws, prints one line, always exits 0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OFFICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMITS = path.join(OFFICE, 'limits.json');
const PUSH_STAMP = path.join(OFFICE, '.statusline-push');
const PUSH_EVERY_MS = 60 * 1000;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

// Returns the parsed object, or null for empty/garbage input (then limits.json is left alone,
// so one bad read never wipes good data).
function readStdin() {
  try {
    if (process.stdin.isTTY) return null;
    return obj(JSON.parse(fs.readFileSync(0, 'utf8')));
  } catch { return null; }
}

function pct(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

// Accepts epoch seconds, epoch ms, numeric strings or ISO dates; returns epoch ms or null.
function epochMs(v) {
  let n = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim() !== '') {
    n = /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : Date.parse(v);
  }
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n < 1e12 ? n * 1000 : n);
}

function window_(w) {
  w = obj(w);
  if (!w) return null;
  const usedPct = pct(w.used_percentage);
  if (usedPct === null) return null;
  return { usedPct, resetsAt: epochMs(w.resets_at) };
}

function push() {
  try {
    if (process.env.AGENT_HQ_PUSH === '0') return;
    const dir = process.env.AGENT_HQ_CONFIG_DIR || path.join(os.homedir(), '.config', 'agent-hq');
    if (!fs.existsSync(path.join(dir, 'config.json'))) return;
    let last = 0;
    try { last = fs.statSync(PUSH_STAMP).mtimeMs; } catch {}
    if (Date.now() - last < PUSH_EVERY_MS) return;
    fs.writeFileSync(PUSH_STAMP, String(Date.now()));
    spawn(process.execPath, [path.join(OFFICE, 'bin', 'office-push.mjs')], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

function save(limits) {
  try {
    let old = null;
    try { old = JSON.parse(fs.readFileSync(LIMITS, 'utf8')); } catch {}
    const same = old && ['provider', 'model', 'fiveHour', 'sevenDay']
      .every((k) => JSON.stringify(old[k] ?? null) === JSON.stringify(limits[k] ?? null));
    if (same) return;
    const tmp = LIMITS + '.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt: Date.now(), ...limits }, null, 2));
    fs.renameSync(tmp, LIMITS);
    push();
  } catch {}
}

function line(l) {
  const parts = ['HQ', l.provider];
  if (l.provider === 'GLM') {
    if (l.model) parts.push(l.model);
  } else {
    if (l.fiveHour) parts.push(`5h ${Math.round(l.fiveHour.usedPct)}%`);
    if (l.sevenDay) parts.push(`wk ${Math.round(l.sevenDay.usedPct)}%`);
    if (!l.fiveHour && !l.sevenDay && l.model) parts.push(l.model);
  }
  return parts.join(' · ');
}

let out = 'HQ';
try {
  const parsed = readStdin();
  const input = parsed || {};
  const model = obj(input.model) || {};
  const rl = obj(input.rate_limits) || {};
  const limits = {
    provider: process.env.HQ_PROVIDER === 'glm' ? 'GLM' : 'Claude',
    model: str(model.display_name, 60) || str(model.id, 60) || str(input.model, 60),
    fiveHour: window_(rl.five_hour),
    sevenDay: window_(rl.seven_day),
  };
  if (parsed) save(limits);
  out = line(limits);
} catch {}
try { process.stdout.write(out + '\n'); } catch {}
process.exitCode = 0;
