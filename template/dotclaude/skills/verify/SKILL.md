---
name: verify
description: Use as the self-check before reporting any finished build or fix, and when reviewing work against a plan's acceptance criteria or definition of done - run tests, linters, builds or live checks and report evidence.
---

# Verify: evidence before reporting

1. Run what the project has: tests, linters, the build, or the app itself. Use the
   commands from the project's `CLAUDE.md` when it lists them.
2. Walk through each acceptance criterion (or DoD item) in order. For each: PASS, FAIL or
   NOT CHECKED, plus the evidence.
3. Evidence is real command output (trimmed), file paths and line numbers. Never write
   "should work" or "tests pass" without the output that shows it.
4. A criterion you couldn't check is NOT CHECKED with the reason, never PASS. Missing
   metrics are "unavailable", never zero.
5. Secret scans: check for "no BEGIN PRIVATE KEY material" (not "grep private_key finds
   nothing"; code may legitimately say `sa.private_key`). Exclude scratch dirs and debug
   logs. Never print secret values in the evidence.
6. RTDB REST checks use the `-default-rtdb` host
   (`https://<project>-default-rtdb.firebaseio.com`), from `databaseURL` in the web config.
   `<project>.firebaseio.com` returns 404.
7. Sandbox shell: no `/tmp`, no shell variables, no `$(...)`, no `cd &&`. Use full literal
   paths or `git -C <path>`. HTTP: `curl -s -o /dev/null -w '%{http_code}'`; headers via
   `-w '%header{name}'` (not `-sI` / `-D -`). Scratch in `~/HQ/office/.tmp-<task>/`.
8. Report the real git state: `git status`, `git diff --stat`, and which tests ran.
9. Anything unexpected goes under a final **Surprises** heading.

## Owner gates (always stop and ask, never do)
Deleting, `git push`, deploying, sending outbound messages, spending money, and fixing a
security issue without an owner-approved SEC ID. Verification never deploys to get a
live check; ask the owner to run the deploy, then check afterwards.
