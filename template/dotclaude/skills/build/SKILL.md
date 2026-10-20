---
name: build
description: Use when making code or config changes in a project (~/Developer/* or ~/HQ/office) from an approved plan or a clear request - editing files, running builds, tests and linters, local git. Includes Firebase Hosting/RTDB rules work and edits to office/state.json.
---

# Build: code changes

## Before you start
1. Read the project's `CLAUDE.md` (and README) and follow its conventions.
2. If working from a plan in `~/HQ/plans/`, read all of it: Goal, Acceptance criteria,
   Files to touch, Steps, Risks and owner actions (⚠️), Status. Do only your step(s).
3. Touch only the files the plan lists. Read beyond them only if you get stuck.
4. Grep `~/HQ/LESSONS.md` for the project name or tag before starting.

## While building
5. Match the surrounding code style. Keep changes scoped to the request.
6. Never delete files outside what the task requires.
7. git: local only. Commit only if asked. Never push, force, or rewrite history.
8. Sandbox shell: no `/tmp`, no shell variables, no `$(...)`, no `cd &&`, no quoted
   heredocs. Use full literal paths, `git -C <path>`, or a small node script.
9. Scratch goes in one reused dir, e.g. `~/HQ/office/.tmp-<task>/`. Don't create many.
   You can't `rm -rf` it; ask the owner to delete it.
10. HTTP checks: `curl -s -o /dev/null -w '%{http_code}'`; read headers with
    `-w '%header{name}'` (not `-sI` / `-D -`).
11. Paths outside `~/HQ` and `~/Developer` (e.g. `~/.config/agent-hq`) are owner steps:
    write the exact commands for the owner (see `runbook`).

## Office state and hooks
12. Before writing `office/state.json` (or any hook-written file), take `office/.lock` and
    re-read the file inside the lock. Never write from a stale copy; live hooks (even your
    own session's Stop) can write at any moment.
13. Never run hook copies from backups: the hook resolves paths from its own location.
    Benchmark from temp copies of `office/`. Pusher tests set HOME (or
    `AGENT_HQ_CONFIG_DIR` plus `AGENT_HQ_TEST=1`) so they never touch the real config.

## Firebase
14. Hosting headers: never put X-Frame-Options/COOP on `"source": "**"`; it also hits the
    `/__/auth/*` sign-in pages. Scope to the page: `"regex": "^/(index\\.html)?$"`.
15. RTDB rules: validate every field the writer actually sends BEFORE adding
    `$other: false`.
16. Run the realistic-payload rules test (e.g. `test-rules.mjs`) before every database
    deploy.
17. Owner read rules require `auth.token.firebase.sign_in_provider === 'google.com'`; a
    service-account writer uid must not keep long-term read access.
18. The RTDB REST host ends in `-default-rtdb`
    (`https://<project>-default-rtdb.firebaseio.com`); take it from `databaseURL`.
19. Firebase deploys are owner-run. Do the pre-flight checks, then stop (see `runbook`).

## Finish
20. Self-check with the `verify` skill before reporting.
21. Report: what changed (paths), how it was verified (commands run and results), what is
    left undone, and the real git state (`git status`, `git diff --stat`, tests run).
22. Anything that didn't match expectations (docs wrong, build steps different, missing
    env) goes under a final **Surprises** heading.

## Owner gates (always stop and ask, never do)
Deleting, `git push`, deploying, sending outbound messages, spending money, and fixing a
security issue without an owner-approved SEC ID. Log unrelated security problems with the
`security` skill (MODE: log) instead of fixing them.
