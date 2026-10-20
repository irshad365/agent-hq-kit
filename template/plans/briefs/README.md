# Brief guide: routing work to GLM

GLM (model `glm-5.3`) runs as a separate headless process that Rowan starts
from the Claude session. This page says when a task goes to GLM, how to run
it, and what a brief contains. See also `docs/SETUP.md` (optional GLM section).

## Routing

GLM gets a task only if all of these hold:

- **(a)** it's routine, with testable acceptance criteria;
- **(b)** it doesn't touch auth, secrets, networking, data exposure, deploys
  or production;
- **(c)** the GLM 5h bar is under 80%.

Prefer GLM when Claude's 5h or weekly bar is above 70%, or Claude is CLOSED.
If a reading is n/a, ask the owner in one line.

Risky work is not sent to GLM at all. The owner can override at any time
with "use GLM" or "use Claude". Don't run the same task on both providers.

## Running

- Start a run with Bash `run_in_background`:
  `~/HQ/bin/glm-run <slug> <brief-file>`
- The wrapper runs `claude -p` in `~/HQ` with `HQ_PROVIDER=glm`,
  `--permission-mode acceptEdits` and the brief as the prompt, so the same
  hooks, skills and rules apply. The auth token comes from the shell
  environment and is never written to a file. The run acts as a Worker and
  launches no agents.
- The office shows the run at Bill's desk; the sign stays Claude. Extra
  simultaneous runs get Celio, Lanette, Bebe, Amanita, in that order, each
  with its own desk.
- Unrelated GLM and Claude work can run in parallel, but only one provider
  at a time in a given repo or file set.

## Brief (`plans/briefs/YYYY-MM-DD-slug.md`)

```
# Brief: <title>
status: queued | running | done | blocked     provider: GLM
project: <slug>   plan: plans/<plan>.md (optional)
## Task         1–5 lines
## Acceptance   numbered, testable
## Files        exact list
## Repo state   branch, HEAD sha, `git status --short` at writing
## Constraints  owner gates, lessons, skills to load
## Result       filled in by the GLM run: what changed, diff stat, test
                output, open items, new HEAD sha
```

Rules:

- The run re-checks the repo state before it starts; if it differs from the
  brief, it stops and reports without changing anything.
- Repo state for non-git folders is line counts (`wc -l`) or a file count.
- A brief is at most about 400 words, excluding Result.
- Result is written from the real diff and test output.

## GLM limits

- No `node`: no tests and no servers.
- No `rm`, `cp` or `git` other than `git init`.
- Cannot write under any `.claude/` folder.
- `acceptEdits` mode, no human in the loop.

When acceptance needs tests, GLM writes the code and the tests; a Sonnet
Worker runs them (verify skill) and compares the results with the brief's
Result. Read-only reviews can run fully on GLM.

## After a run

Rowan reads the brief's Result, checks the evidence against the acceptance
criteria, and for builds sends a Sonnet verify.
