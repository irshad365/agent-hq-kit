#!/usr/bin/env node
// Serves the office: site/index.html + site/library.js at /, plus a fixed whitelist of data
// files from this folder (state.json, events.jsonl, projects.json, library.json, limits.json, glm.json, tasks.json).
// Nothing else is reachable (no hook-debug.jsonl, firebase-web-config.json, bin/, .backup*).
// Usage: node office/serve.mjs [port] [--lan]   (default port 4747, PORT env also works)
// Listens on 127.0.0.1 only. LAN access is opt-in: --lan, or HOST=0.0.0.0 (HOST must be an IP).
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const OFFICE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 4747);
// zsh has a HOST shell variable holding the machine name; only an explicit IP literal counts.
const HOST = args.includes('--lan') ? '0.0.0.0' : (net.isIP(process.env.HOST || '') ? process.env.HOST : '127.0.0.1');
const LAN = HOST === '0.0.0.0' || HOST === '::';
const JSON_T = 'application/json';
// [file, content-type, body to send when the file is missing (undefined = 404)]
const FILES = {
  '/': ['site/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['site/index.html', 'text/html; charset=utf-8'],
  '/library.js': ['site/library.js', 'text/javascript; charset=utf-8'],
  '/state.json': ['state.json', JSON_T],
  '/events.jsonl': ['events.jsonl', 'text/plain; charset=utf-8', ''],
  '/projects.json': ['projects.json', JSON_T, '{}'],
  '/library.json': ['library.json', JSON_T, '{}'],
  '/limits.json': ['limits.json', JSON_T, '{}'],
  '/glm.json': ['glm.json', JSON_T, '{}'],
  '/tasks.json': ['tasks.json', JSON_T, '{}'],
};

http.createServer((req, res) => {
  const entry = FILES[new URL(req.url, 'http://x').pathname];
  if (!entry) { res.writeHead(404).end('not found'); return; }
  fs.readFile(path.join(OFFICE, entry[0]), (err, buf) => {
    if (err) {
      if (entry[2] === undefined) { res.writeHead(404).end(''); return; }
      buf = Buffer.from(entry[2]); // optional file not written yet
    }
    res.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(buf);
  });
}).listen(PORT, HOST, () => {
  if (!LAN) {
    const where = HOST === '127.0.0.1' ? `http://localhost:${PORT}` : `http://${net.isIPv6(HOST) ? `[${HOST}]` : HOST}:${PORT}`;
    console.log(`Agent HQ office: ${where}  (bound to ${HOST} only; add --lan or HOST=0.0.0.0 for phone/LAN access)`);
    return;
  }
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);
  console.log(`Agent HQ office: http://localhost:${PORT}  ${ips.join('  ')}  (LAN mode: anyone on this network can view it, no auth)`);
});
