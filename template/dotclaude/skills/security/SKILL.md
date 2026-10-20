---
name: security
description: Use whenever a security issue is noticed (secrets in repos, exposed ports or databases, weak auth, vulnerable config), when logging, re-checking or auditing findings in ~/HQ/SECURITY.md, when a prompt says "MODE: log", "MODE: fix SEC-###" or "MODE: review", and when reviewing auth, rules, headers or secret handling.
---

# Security: SECURITY.md register

Every prompt has a mode; the default is `log`. Do only what the mode allows.

## MODE: log
1. Verify read-only: read files; harmless commands like `git -C <repo> ls-files`,
   `git check-ignore`, `git log --oneline -- <file>`. Don't change files, run services,
   scan networks or contact external hosts.
2. Check the register for an existing entry; update it instead of adding a duplicate.
3. Add or update the entry using the template below. Write `SECURITY.md` and nothing else.
4. Never copy secret values (keys, passwords, tokens, .env contents) into the register or
   the report. Name the file and the kind of secret, not the value.

## MODE: fix SEC-### (owner approved)
5. Valid only when the prompt names specific IDs and says "owner approved". Otherwise
   log it and stop.
6. Fix only those IDs. If a fix needs more (rotating a key, a deploy, a production server
   change, rewriting git history), stop and describe the steps; the owner approves those
   separately (see `runbook`).
7. Don't push, deploy or rewrite git history. Leave changes for the owner to review.
8. Verify the fix, then set status `fixed` with the date and what changed. If a secret was
   exposed, the fix isn't complete until it is rotated; say so.

## MODE: review
9. Read-only re-check of open findings (still present?), with status updates in the
   register. Also a read-only audit of a named project when the owner asks.

## Known checks (from lessons)
10. Firebase Hosting headers on `"source": "**"` also hit `/__/auth/*` and can break
    Google sign-in; scope them to `"regex": "^/(index\\.html)?$"`.
11. RTDB rules: every field the writer sends is validated before `$other: false`; the
    realistic-payload rules test (e.g. `test-rules.mjs`) runs before every database deploy.
12. Owner reads require `auth.token.firebase.sign_in_provider === 'google.com'`; a uid
    minted from a service account can be forged with a stolen key. The writer uid must not
    keep long-term read access.
13. Secret-scan checks are worded "no BEGIN PRIVATE KEY material" and exclude scratch dirs
    and debug logs.

## Register entry template
```
## SEC-###: <short title>
- **Severity:** critical | high | medium | low
- **Status:** open | approved | fixed | dismissed | needs-owner
- **Project/where:** <project> · <file path(s)>
- **Found:** YYYY-MM-DD by <who noticed it>
- **Verified:** yes/no and how
- **Risk:** what an attacker could do, in one or two sentences
- **Proposed fix:** concrete steps, and which need the owner (rotation, deploy, server)
- **History:** dated one-liners (logged, approved, fixed ...)
```
14. IDs are sequential and never reused (check the register and any `SECURITY-archive.md`
    for the highest ID). Keep the summary table at the top in sync.

## Report
15. The IDs logged or updated, with severity and a one-line summary each; for fixes, the
    real git state (`git status`, `git diff --stat`, tests run).

## Owner gates (always stop and ask, never do)
Deleting, `git push`, deploying, sending outbound messages, spending money, key rotation,
and any fix without an owner-approved SEC ID in the prompt.
