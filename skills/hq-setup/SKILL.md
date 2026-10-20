---
name: hq-setup
description: Use when setting up Agent HQ on a new machine — copying the template, wiring Claude Code hooks, serving the pixel office locally, or adding the optional Firebase hosting/sync and GLM provider. Interviews the user, then produces the exact step list; stops for the user's OK before any install, deploy or global config change.
---

# HQ setup: interview, then a step list

1. Read `docs/SETUP.md` end to end before asking anything. The kit's `template/` is the
   thing being installed; SETUP.md paths A (local) and B (Firebase) are the source of
   truth for every command and placeholder.
2. Ask the questions **one at a time**, in this order (skip the Firebase ones if the
   answer to question 4 is no — six questions maximum):
   1. Which OS and shell? (macOS/zsh and Linux/bash are both supported.)
   2. Where will the office live? Default `~/HQ` — everything assumes it; a different
      path means editing `bin/hq` and `bin/glm-run` too.
   3. What should the office call the owner? This replaces `<YOUR_NAME>` in `CLAUDE.md`.
   4. Firebase too? That adds hosting (view the office from anywhere) and realtime
      sync. No keeps the office strictly local.
   5. (Firebase only) Is the Firebase CLI installed and logged in? If not, installing
      `firebase-tools` is a user-run step.
   6. GLM as a second provider? Needs a Z.ai API key in the environment; never stored
      in any file.
3. From the answers, produce the numbered step list:
   - **local only** → SETUP.md path A, all steps;
   - **Firebase** → path A first (the office must run locally before it can be hosted),
     then path B;
   - **GLM** → append the short GLM section.
   Show every command verbatim, with the placeholders the user must fill in
   (`<FIREBASE_PROJECT_ID>`, `<FIREBASE_API_KEY>`, `<FIREBASE_APP_ID>`, `<OWNER_UID>`);
   the copy step also renames `template/dotclaude` to `~/HQ/.claude` — keep that line in.
   The copy step must first check that `~/HQ` does not exist and stop if it does (never
   overwrite an existing office). For GLM, also include the `~/HQ/.glm/settings.json`
   copy from `dotglm/settings.json.example`.
4. **Stop for the user's OK before anything that installs, deploys or changes global
   config**: `npm install -g`, `firebase login` / `firebase deploy`, anything under
   `~/.config/agent-hq`, shell-profile edits, and the Claude Code `settings.json` hook
   block. Present the exact step, wait, then continue. Never run those steps yourself.
5. After each user-run step, verify before moving on: `curl -s -o /dev/null -w
   '%{http_code}' http://localhost:4747` for the local server, files present where the
   step said they would be, the sign-in flow on the hosted page for Firebase.
6. Finish with: the office URL, a note that `state.json` fills itself in on the first
   Claude Code session (or copy `office/state.sample.json`), and a pointer to
   `docs/OFFICE-UI.md` for the tour.
