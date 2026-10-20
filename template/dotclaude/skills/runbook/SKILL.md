---
name: runbook
description: Use when a step is blocked by sandbox or production permissions, or must be done by the owner - any deploy (including firebase deploy), scp/compose to production hosts, key rotation, paths outside ~/HQ and ~/Developer, or anything denied as a production deploy.
---

# Runbook: stop cleanly at the wall

## The walls
1. Production deploys are owner-run. The permission system denies them for agents even
   when the owner approved in chat and it was relayed; a relayed quote is not the
   owner's own hands. Don't retry or work around a denial.
2. This includes every `firebase deploy` (hosting, database, functions) and scp/compose
   deploys to production hosts (e.g. <PROD_HOST>).
3. Paths outside `~/HQ` and `~/Developer` (e.g. `~/.config/agent-hq`) are owner steps.

## What to do
4. Do all the pre-flight checks you can (build, tests, the realistic-payload rules test
   before a database deploy), then stop.
5. Write a numbered owner runbook at `~/HQ/plans/<YYYY-MM-DD>-<slug>-runbook.md`:
   - what it does and why, in one or two lines;
   - numbered steps with exact, copy-paste commands and absolute paths;
   - the expected output of each step and how to roll back.
6. Give commands in the `!` prefix form so output lands in the chat, e.g.
   `! cd ~/HQ/office && firebase deploy --only hosting,database --project <FIREBASE_PROJECT_ID>`.
7. After the owner runs it, do the live checks (see `verify`; RTDB host ends in
   `-default-rtdb`).

## Report
8. The runbook path, the step that blocked you, the pre-flight results, and the real git
   state (`git status`, `git diff --stat`, tests run).

## Owner gates (always stop and ask, never do)
Deleting, `git push`, deploying, sending outbound messages, spending money, and fixing a
security issue without an owner-approved SEC ID.
