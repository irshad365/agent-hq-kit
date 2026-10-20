# Agent HQ — share kit

Agent HQ is a small orchestration layer on top of [Claude Code](https://claude.com/claude-code).
One main session — **Prof. Rowan**, the office manager — sizes each request, answers simple
questions itself, writes short plans for features, and sends real work to **Workers**
(Sonnet subagents). Workers load **skills** (survey, build, verify, security, record,
chores, runbook) that encode how work is done here, and an independent **Reviewer**
re-checks anything risky (auth, secrets, networking, deploys, data exposure). The office
keeps `plans/`, a tagged `LESSONS.md`, a `SECURITY.md` register, and a **pixel office** —
a little web page that shows every trainer at their desk, live, while they work.

## Who it's for

- You use Claude Code on macOS or Linux and want delegation to subagents with structure:
  plans, lessons, security logging, and an independent review step.
- You like watching what your agents are doing: the office page shows who is working,
  sleeping or idle, what task they're on, usage limits, and your project library.
- You want local-first: the default setup runs entirely on your machine. Firebase hosting
  and phone access are optional.

## Quick start (local path, no Firebase)

You need Claude Code, Node 18+ and git (details in [docs/SETUP.md](docs/SETUP.md)).

```sh
mkdir -p ~/HQ
cp -R template/. ~/HQ/
mv ~/HQ/dotclaude ~/HQ/.claude
node ~/HQ/office/serve.mjs
```

Open <http://localhost:4747>. To see the office populated before your first session:

```sh
cp ~/HQ/office/state.sample.json ~/HQ/office/state.json
```

Then wire the Claude Code hooks (one JSON block, shown in SETUP.md path A step 3) and
start Claude Code in `~/HQ`. Workers appear on the page as they work.

## What's in the kit

```
README.md            this file
.gitignore           runtime files (state.json etc.) never get committed
docs/SETUP.md        prerequisites + the local path, the Firebase path, optional GLM
docs/OFFICE-UI.md    tour of the pixel office (screenshot placeholders)
skills/hq-setup/     a Claude Code skill that interviews you and picks your path
template/            the office itself — copy this to ~/HQ
  CLAUDE.md          Prof. Rowan's instructions (edit <YOUR_NAME>)
  dotclaude/         agents and skills — the copy step renames it to .claude
  bin/               hq and glm-run launchers
  office/            the pixel office: site, hooks, pusher, local server
```

`template/` ships with placeholders like `<YOUR_NAME>`, `<FIREBASE_PROJECT_ID>`,
`<FIREBASE_API_KEY>`, `<FIREBASE_APP_ID>` and `<OWNER_UID>` where your own values go —
SETUP.md walks through each one. `LESSONS.md`, `SECURITY.md` and `projects/INDEX.md` are
empty starters; your office fills them in as it works.

A tour of the office page is in [docs/OFFICE-UI.md](docs/OFFICE-UI.md).

## License

MIT, see [LICENSE](LICENSE).
