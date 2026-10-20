# Setting up your own Agent HQ

There are two paths. **Path A (local only)** is the default and the whole office runs on
your machine — nothing leaves it. **Path B (Firebase)** is optional and adds hosted pages
plus realtime sync, so you can watch the office from your phone. A short optional section
covers **GLM** as a second model provider.

Every command on this page is one **you** run. Anything that installs software, deploys,
or changes global config (the Firebase CLI, `~/.config`, deploys) is yours to run — the
office's agents never run those themselves.

## Prerequisites

- macOS or Linux, with a POSIX shell (zsh, bash).
- **Claude Code** installed and logged in (`claude --version` should print a version).
- **Node 18 or newer** (`node --version`) — the office server, hooks and pusher are plain
  Node with no npm dependencies.
- **git** (`git --version`) — the kit is meant to live in a repo.
- Path B only: a Google account, and `firebase-tools` (installed in step B1).

Nothing else. There is no `npm install` for the office itself.

---

## Path A: local only (no Firebase)

### A1. Copy the template into place

From the kit folder (the folder this `docs/` lives in):

```sh
if [ -e ~/HQ ]; then
  echo "~/HQ already exists - stop, do not overwrite"
else
  mkdir -p ~/HQ
  cp -R template/. ~/HQ/
  mv ~/HQ/dotclaude ~/HQ/.claude
fi
```

If `~/HQ` already exists the check stops you; move it aside or pick another folder
before continuing.

The `/.` matters: `cp -R template/.` copies dotfolders too. The agents and skills ship
as `dotclaude/` so you can see them in a file listing; the `mv` turns them into the
`.claude/` directory Claude Code reads (`agents/`, `skills/`).

### A2. Look at the office

```sh
node ~/HQ/office/serve.mjs
```

The port is optional: `node ~/HQ/office/serve.mjs 4848` (or `PORT=4848`). Open
<http://localhost:4747> for the default. With no data yet the page says "Office offline —
retrying…", which is correct. To see a populated office immediately, in a second shell:

```sh
cp ~/HQ/office/state.sample.json ~/HQ/office/state.json
```

and reload. `serve.mjs` serves only the site plus a fixed whitelist of data files, and
binds to 127.0.0.1 only. Phone/LAN access is opt-in and unauthenticated — run
`node ~/HQ/office/serve.mjs --lan` only on networks you trust.

### A3. Wire the Claude Code hooks

The office updates when Claude Code tells it what happened. Put this in
`~/HQ/.claude/settings.json` (create the file; if one exists, merge the `hooks` and
`statusLine` keys in). It is a global-ish change to how Claude Code behaves in this
project — yours to make:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/office/bin/office-hook.mjs session-start" } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/office/bin/office-hook.mjs prompt" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/office/bin/office-hook.mjs stop" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Agent|Task",
        "hooks": [ { "type": "command",
          "command": "node \"$CLAUDE_PROJECT_DIR\"/office/bin/office-hook.mjs pre-agent" } ] },
      { "matcher": "Skill",
        "hooks": [ { "type": "command",
          "command": "node \"$CLAUDE_PROJECT_DIR\"/office/bin/office-hook.mjs skill" } ] }
    ],
    "SubagentStart": [
      { "hooks": [ { "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/office/bin/office-hook.mjs subagent-start" } ] }
    ],
    "SubagentStop": [
      { "hooks": [ { "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/office/bin/office-hook.mjs subagent-stop" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/office/bin/office-hook.mjs session-end" } ] }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "node ~/HQ/office/bin/office-statusline.mjs"
  }
}
```

(Replace `~/HQ` if you installed elsewhere.) The hooks are designed never to block
Claude: they print nothing, always exit 0, and hand slow work to a detached child.

### A4. Make it yours

- Edit `~/HQ/CLAUDE.md` and replace `<YOUR_NAME>` with what the office should call you.
- Optional: put `~/HQ/bin` on your PATH, then `hq` starts Claude Code in the office.

### A5. Start the office

```sh
cd ~/HQ && claude
```

Ask for something. Within a few seconds the page at :4747 shows Prof. Rowan at the boss
desk and — when a request is delegated — a Worker hired from the trainer-name pool and
put to work at a desk. `state.json` and `events.jsonl` appear in `~/HQ/office/` on the
first session; they are gitignored, like all runtime files.

That is the whole local path. Nothing phones home; the page is only reachable from your
machine.

---

## Path B: optional Firebase (hosting + realtime sync)

Do path A first. Then:

### B1. Install and log in to the Firebase CLI (you run this)

```sh
npm install -g firebase-tools
firebase login
```

### B2. Create the project

```sh
firebase projects:create <FIREBASE_PROJECT_ID>
```

Pick a globally unique id; it names everything (`<FIREBASE_PROJECT_ID>.web.app`, the
database URL, the service account email).

### B3. Enable Google sign-in

Firebase console → Build → Authentication → Get started → sign-in provider **Google** →
Enable. Leave the support email as your own.

### B4. Create a Realtime Database

Console → Build → Realtime Database → Create database. Choose a region (e.g.
`us-central1`); the URL will look like
`https://<FIREBASE_PROJECT_ID>-default-rtdb.firebaseio.com`. Start in **locked mode** —
`office/database.rules.json` replaces the rules at deploy time and is stricter.

### B5. Register a web app and fill in the page config

Console → Project settings → Your apps → Web (`</>`) → register (no hosting needed yet)
→ copy the `firebaseConfig` values into `~/HQ/office/site/index.html`, replacing:

| Placeholder | Comes from |
|---|---|
| `<FIREBASE_API_KEY>` | `apiKey` (a public web-client identifier, not a secret) |
| `<FIREBASE_PROJECT_ID>` | `projectId` — also in `authDomain` and `databaseURL` |
| `<FIREBASE_APP_ID>` | `appId` |

Keep the surrounding URL forms (`<FIREBASE_PROJECT_ID>.firebaseapp.com`,
`https://<FIREBASE_PROJECT_ID>-default-rtdb.firebaseio.com`) and just substitute the id.
The page refuses to try Firebase while any value still contains a `<` placeholder.

### B6. Put your owner UID in the rules

Deploy (B9) once, open `https://<FIREBASE_PROJECT_ID>.web.app`, and **sign in** with the
Google account from B3. Then console → Authentication → Users → copy the **User UID**,
and replace `<OWNER_UID>` with it in **both** places:

- `~/HQ/office/database.rules.json` — the `/office` `.read` rule,
- `~/HQ/office/site/index.html` — `const OWNER_UID = '<OWNER_UID>';`

They must stay identical: the rules enforce access, the page just avoids a denied read.
Everyone who is not you gets the public view automatically.

### B7. Pusher config (mirrors the office to the database)

The pusher (`office/bin/office-push.mjs`) writes state to RTDB after every hook fire. It
only reads config from `~/.config/agent-hq/` at runtime — a directory the agents never
touch. Set it up (you run all of this):

1. Console → Project settings → Service accounts → **Create service account**, name it
   exactly `office-writer`, no roles. Its email must read
   `office-writer@<FIREBASE_PROJECT_ID>.iam.gserviceaccount.com` (if the console shows a
   different local part, use that as `writerUid` in `config.json` below instead).
2. Create a JSON key for it and save it as `~/.config/agent-hq/service-account.json`.
3. Write `~/.config/agent-hq/config.json`:

   ```json
   {
     "projectId": "<FIREBASE_PROJECT_ID>",
     "apiKey": "<FIREBASE_API_KEY>",
     "databaseURL": "https://<FIREBASE_PROJECT_ID>-default-rtdb.firebaseio.com",
     "writerUid": "office-writer"
   }
   ```

4. Lock the permissions — the pusher refuses to run otherwise:

   ```sh
   chmod 700 ~/.config/agent-hq
   chmod 600 ~/.config/agent-hq/service-account.json ~/.config/agent-hq/config.json
   ```

If a push is ever skipped, the reason is in `~/.config/agent-hq/push-status`
(`disabled:project`, `disabled:url`, `disabled:mode`, `disabled:key`, …). `token.json`
there is the pusher's cached auth token — also secret, also mode 600, written by itself.

### B8. What gets deployed

`office/firebase.json` deploys `office/site/` to Hosting (the JSON ignore list keeps
every data file out) and `office/database.rules.json` to RTDB. Emulator ports if you want
them: database 9000, auth 9099, hosting 5000.

### B9. Deploy (you run this)

From a session in `~/HQ`, using the `!` prefix so the output lands in the chat:

```
! cd ~/HQ/office && firebase deploy --only hosting,database --project <FIREBASE_PROJECT_ID>
```

Deploying is always a user step here — the office's workers are blocked from it by
design and will write you a runbook instead.

### B10. Check it

Open `https://<FIREBASE_PROJECT_ID>.web.app`: signed out you see the public view (scene,
sign, book titles — no task text, no feed, no usage); signed in as the owner you see
everything, updating live over the RTDB `/office` node. The public view reads `/public`,
a whitelisted subset written by the same pusher.

---

## Optional: GLM as a second provider

The office can run its workers on a [Z.ai](https://z.ai) GLM coding plan alongside
Claude. Keep it short:

1. Get an API key from Z.ai and export it in your shell (`export ZAI_API_KEY=…` in your
   profile). The key lives in the environment only — no file in the office ever stores
   it, and the office refuses to log it.
2. Create `~/.config/agent-hq/glm-settings.json` (you run this) mapping Claude Code's
   model tiers to GLM:

   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
       "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.3",
       "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.3",
       "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-5.3"
     }
   }
   ```

   (Check Z.ai's current docs for the endpoint and model names.)

   `bin/glm-run` reads `~/HQ/.glm/settings.json`, which the kit ships as
   `template/dotglm/settings.json.example`. Install it (no token goes in this file):

   ```sh
   mkdir -p ~/HQ/.glm
   cp ~/HQ/dotglm/settings.json.example ~/HQ/.glm/settings.json
   ```

   GLM workers run headless in `acceptEdits` mode, so the file allows only
   `Bash(git init:*)` and denies `node`, `python`, `python3`, `sh`, `bash`, `zsh`, `rm`
   and `curl`. **Never allow interpreters**: anything that can run code lets GLM run any
   command, which bypasses every other restriction.

3. `hq glm` (or `claude --settings ~/.config/agent-hq/glm-settings.json` in `~/HQ`)
   starts the office on GLM; `bin/glm-run <slug> <brief-file>` runs a headless worker on
   a brief from `~/HQ/plans/briefs/`.
4. With `ZAI_API_KEY` present, the office also fetches your GLM plan quota every 10
   minutes and shows it as `G5H` / `GWK` bars next to the Claude bars on the sign —
   `n/a` when Z.ai doesn't report a window. Remote Control (phone sessions) works best
   on plain Claude; GLM mode uses its own token.

5. **Routing.** Rowan sends a task to GLM only when it is routine with testable acceptance
   criteria, does not touch auth, secrets, networking, data exposure, deploys or
   production, and the GLM 5h bar is under 80%. Prefer GLM when Claude's bars are above
   70% or the office is CLOSED. Full rules and the brief format are in
   `plans/briefs/README.md`. Limits: the GLM run has no interpreters (no `node`, so no
   tests or servers), no `rm`/`cp`/`git` beyond `git init`, and cannot write under
   `.claude/`; a Claude Worker runs the tests and verifies the result.
6. **Desks.** A GLM run appears at its own desk with a violet cap: Bill first, then
   Celio, Lanette, Bebe and Amanita when runs overlap (see [OFFICE-UI.md](OFFICE-UI.md)).

## Troubleshooting

- **Page says "Office offline — retrying…"** — `state.json` doesn't exist yet (A2), or
  `serve.mjs` isn't running.
- **"Firebase not configured yet"** — a `firebaseConfig` value in `index.html` still
  contains a `<…>` placeholder (B5).
- **Public view although you signed in** — your UID isn't in `database.rules.json` and
  `index.html` yet, or the two disagree (B6).
- **`push-status` says `disabled:…`** — see B7; the most common ones are `mode` (config
  dir or key too open — rerun the chmods) and `email` (service account name isn't
  `office-writer@…`).
- **Nothing updates on the hosted page** — hooks not wired (A3), or
  `~/.config/agent-hq/config.json` missing (B7); local view works either way.
