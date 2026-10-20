# Porting map: v2 agent rules → v3 skills

Each hard rule from the six retired v2 agent files, and where it now lives
(`skill:line` refers to `~/HQ/.claude/skills/<skill>/SKILL.md`). Lesson rules follow.

## scout.md → survey
| v2 rule (scout.md line) | Now in |
|---|---|
| Read-only: no edits, installs, commits, side effects (10) | survey:9 |
| Bash only for `ls`, `git log`, `git status`, `du`, `file`, `mdls` (11) | survey:10 |
| Read the project's `CLAUDE.md` first (12) | survey:11 |
| Answer first, then evidence: absolute paths, short excerpts (13) | survey:22 |
| Ambiguity/surprises under a final **Surprises** heading (14-16) | survey:25 |

## builder.md → build
| v2 rule (builder.md line) | Now in |
|---|---|
| Read `CLAUDE.md` (and README), follow conventions (9) | build:9 |
| Match code style; keep changes scoped (10) | build:16 |
| Verify (build/tests/run) and report what ran and result (11) | build:50, build:51, verify:8-12 |
| Commit only if asked; never push, force, rewrite history (12) | build:18 |
| Never delete files outside what the task requires (13) | build:17 |
| Report: what changed, how verified, what's left undone (14) | build:51 |
| Surprises heading (15-16) | build:53 |

## runner.md → chores
| v2 rule (runner.md line) | Now in |
|---|---|
| Prefer `~/.Trash` over `rm`; never delete what wasn't asked (10) | chores:9 |
| Don't overwrite; pick a new name and mention it (11) | chores:11 |
| Scripts in scratch, not owner's folders (12) | chores:12 |
| Report briefly: what you did, results' absolute paths (13) | chores:20 |
| Surprises heading (14) | chores:22 |

## archivist.md → record
| v2 rule (archivist.md line) | Now in |
|---|---|
| INDEX.md: one row per project, columns, sorted by name (11-12) | record:16 |
| LESSONS.md append-only; entry format (13-14) | record:18 |
| Project CLAUDE.md location (15) | record:20 |
| Never overwrite an existing CLAUDE.md; edit sections only (18) | record:23 |
| New ones short and factual: what, stack, run/build/test, folders, conventions, gotchas (19-20) | record:25 |
| Only write what was verified; mark guesses "(unverified)" (20-21) | record:27 |
| Never commit to git; leave files for the owner (22) | record:30 |
| Report: files created/changed, one line each (24) | record:32 |

## security.md → security
| v2 rule (security.md line) | Now in |
|---|---|
| Every prompt has a mode; do only what it allows; log is default (11, 13) | security:8 |
| Log: verify read-only, harmless commands, no services/scans/external hosts (15-17) | security:11 |
| Log: update existing entry, no duplicates (18) | security:14 |
| Log: write `SECURITY.md` and nothing else (19-20) | security:15 |
| Never copy secret values; name file and kind (21-22) | security:16 |
| Fix: only when prompt names IDs and says owner approved (25) | security:20 |
| Fix: only those IDs; stop and describe rotation/deploy/prod/history steps (26-28) | security:22 |
| Fix: don't push, deploy, rewrite history; leave for review (29) | security:25 |
| Fix: verify, set `fixed` with date; exposed secret needs rotation (30-31) | security:26 |
| Review: read-only re-check of open findings; read-only audit on request (33-35) | security:30 |
| Register entry template (37-48) | security:44-55 |
| IDs sequential, never reused; summary table in sync (49) | security:56 |
| Report: IDs logged/updated, severity, one-liner (51) | security:60 |

## planner.md → build (plan reading)
| v2 rule (planner.md line) | Now in |
|---|---|
| Plan sections (Goal, Design/criteria, Steps with files, ⚠️ owner actions, Risks, DoD, Status) (13-21) | build:10 (read all sections, do only your step) |
| Steps name the files to touch (16) | build:12 |
| Investigate first: CLAUDE.md, LESSONS.md, prompt pointers (10-11) | build:9, build:13 |
| Bash read-only; never install, sign in, deploy (11-12) | owner gates block in every skill; runbook:9-14 |
| Writing plans, phone-length, ⚠️ markers, 5-line summary report (13-23) | Not a worker skill: plans are written by Rowan in v3 (design plan, "Plans"). |

## LESSONS.md rules
| Lesson | Now in |
|---|---|
| Firebase `**` headers hit `/__/auth/*`; scope with regex | build:37, security:34 |
| RTDB: validate every field before `$other: false` | build:39, security:36 |
| Realistic-payload rules test before every DB deploy | build:41, security:36, runbook:17 |
| `sign_in_provider === 'google.com'`; writer uid no long-term read | build:43, security:38 |
| DoD wording "no BEGIN PRIVATE KEY material", exclude scratch/logs | verify:16, security:41 |
| Sandbox: no /tmp, shell vars, `$(...)`, `cd &&`, quoted heredocs | build:19, chores:13, verify:22 |
| Sandbox: one reused scratch dir, owner deletes it | build:21, chores:15, verify:22 |
| Sandbox: curl `-w '%{http_code}'` / `%header{}` | build:23, chores:16, verify:22 |
| Paths outside HQ/Developer (`~/.config/agent-hq`) are owner steps | build:25, chores:18, runbook:14 |
| Production deploy wall; numbered owner runbook in plans/ | runbook:9, runbook:19 |
| Firebase deploys owner-run; `!` prefix command pattern | runbook:12, runbook:23, build:47 |
| state.json: take `office/.lock`, re-read inside lock | build:29 |
| Don't run hook copies from backups; HOME / AGENT_HQ_TEST for pusher tests | build:32 |
| Marker-file globs; never `*` on ~/Developer | survey:12, survey:14 |
| No shell: branch/remote/last commit from .git files | survey:16-19 |
| RTDB host ends in `-default-rtdb` | build:45, verify:19, runbook:25 |

## Cross-cutting rules (added for v3)
| Rule | Now in |
|---|---|
| Owner gates: delete, push, deploy, outbound messages, spending, unapproved security fixes | survey:28, build:56, verify:28, security:63, record:36, chores:24, runbook:32 |
| Handoff states real git state (status, diff stat, tests run) | survey:24, build:51, verify:25, security:60, record:32, chores:20, runbook:29 |
| verify: evidence not claims; walk each acceptance criterion | verify:10, verify:12 |
| verify: missing metrics are "unavailable", never zero | verify:14 |
| record: write memory only when something lasting changed | record:9-13 |
| record: create a project CLAUDE.md when missing | record:24 |
| survey: summary of 300 words or less | survey:23 |
