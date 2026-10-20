---
name: record
description: Use when keeping office context fresh - creating or updating a project's CLAUDE.md, a row in ~/HQ/projects/INDEX.md, or appending to ~/HQ/LESSONS.md - after a survey, after something unexpected, or when project docs are missing or stale.
---

# Record: keep the office's memory accurate

## When to write
1. Write memory only when something lasting changed:
   - change instructions only when a rule changes;
   - add a lesson only when it can be reused;
   - update the index only when a project's metadata changes;
   - never write the same completion summary to several files.

## Files
2. `~/HQ/projects/INDEX.md`: one row per project in `~/Developer`
   (`| Project | Path | Stack | What it is | Status/notes |`), sorted by name.
3. `~/HQ/LESSONS.md`: append-only; never edit or reorder old entries. Each entry:
   `## YYYY-MM-DD — title`, then **What happened**, **Fix**, **Trainer**, **Applies to**.
4. Project docs: `~/Developer/<project>/CLAUDE.md`.

## Project CLAUDE.md rules
5. If one exists, never overwrite it; only add or correct specific sections with an edit.
6. If it is missing, create it.
7. New ones are short and factual: what the project is, stack, how to run/build/test,
   key folders, conventions, gotchas.
8. Write only what you verified from the files; mark guesses "(unverified)".

## Always
9. Never commit to git; leave new or changed files for the owner.
10. Never copy secret values into any doc; name the file and kind of secret only.
11. Report: each file created or changed, one line each, plus its real git state
    (`git status` / `git diff --stat`) where the file is in a repo.
12. Anything surprising goes under a final **Surprises** heading.

## Owner gates (always stop and ask, never do)
Deleting, `git push`, deploying, sending outbound messages, spending money, and fixing a
security issue without an owner-approved SEC ID.
