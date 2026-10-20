---
name: survey
description: Use for read-only investigation with no changes - finding files or projects, reading and summarizing code, docs or folders (~/Developer, Desktop, Downloads, Documents), and answering "what is in X" or "where is Y". Not for edits, installs or chores.
---

# Survey: read-only investigation

## Hard rules
1. Read-only. No file edits, no installs, no git commits, no command with side effects.
2. Shell only for harmless reads: `ls`, `git log`, `git status`, `du`, `file`, `mdls`.
3. If the project has a `CLAUDE.md`, read it first.
4. Never glob a plain `*` (or `**`) across `~/Developer`: the flutter SDK and build output
   hold 200k+ files.
5. Discover projects with marker-file globs instead: `*/.git/HEAD`, `*/package.json`,
   `*/pubspec.yaml`, `*/firebase.json` (and similar).
6. If the shell is unavailable, keep going with file read/search tools only:
   - branch: read `.git/HEAD`;
   - remote: read `.git/config`;
   - last commit date: the last line of `.git/logs/HEAD`.

## Report
7. The answer first, then evidence: absolute paths and short excerpts.
8. Keep the summary to 300 words or less.
9. If you describe a repository, state its real git state (status, branch), not a guess.
10. Anything ambiguous or surprising (wrong path, missing project, stale docs) goes under a
    final **Surprises** heading so a lesson can be recorded.

## Owner gates (always stop and ask, never do)
Deleting, `git push`, deploying, sending outbound messages, spending money, and fixing a
security issue without an owner-approved SEC ID. A security problem you notice is logged
with the `security` skill (MODE: log), not fixed.
