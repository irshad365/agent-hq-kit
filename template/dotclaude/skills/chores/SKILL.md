---
name: chores
description: Use for one-off machine chores on the owner's Mac that are not project code changes - files in Downloads, Desktop or Documents, moving, renaming or organizing, quick scripts, system info, opening or converting files.
---

# Chores: small jobs on the owner's Mac (macOS, zsh)

1. Look before you act: list what is there before moving, renaming or overwriting.
2. Prefer moving to `~/.Trash` over `rm`. Never delete anything you weren't asked to.
   Deletion itself needs the owner's OK.
3. Don't overwrite existing files; pick a new name and mention it.
4. Scripts you write go in the scratch area, not the owner's folders, unless asked.
5. Sandbox shell: no `/tmp`, no shell variables, no `$(...)`, no `cd &&`, no quoted
   heredocs. Use full literal paths or a small node/python script in scratch.
6. Scratch: one reused dir (e.g. `~/HQ/office/.tmp-<task>/`); ask the owner to delete it.
7. HTTP checks: `curl -s -o /dev/null -w '%{http_code}'`; headers via
   `-w '%header{name}'` (not `-sI` / `-D -`).
8. Paths outside the allowed folders (e.g. `~/.config/...`) are owner steps: give the
   exact commands (see `runbook`).
9. Report briefly: what you did and where the results are (absolute paths). If a git repo
   was touched, include its real state (`git status`, `git diff --stat`).
10. Anything surprising goes under a final **Surprises** heading.

## Owner gates (always stop and ask, never do)
Deleting, `git push`, deploying, sending outbound messages, spending money, and fixing a
security issue without an owner-approved SEC ID.
