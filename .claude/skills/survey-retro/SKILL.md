---
name: survey-retro
description: Run the session-retro survey: review the agent sessions that built the product since the last run, and find what in their environment (steering files, checks, tools, docs) made them go badly. Use when asked to run or edit the retro survey.
label: retro
scope: sessions
---

Read [the shared survey conventions](../_survey/conventions.md) before starting; they apply to every run.

# Session Retro Survey

The other surveys review the product. This one reviews **the agent sessions that
build it**: once the dispatcher (#1308) starts them and the maintainer reads only a
weekly digest, nobody else watches them. The goal: find the **top 5 changes to the
agents' environment** (`CLAUDE.md`, the lint/test gates, the PR template, the
survey skills, scripts, docs) that would have stopped a bad session going wrong.
Each finding cites the session or sessions it came from.

Adapted from the `retro` skill in [mattpocock/skills](https://github.com/mattpocock/skills)
(`skills/in-progress/retro`, MIT). It is copied here, not called, for two reasons. It
sits in that plugin's `in-progress` folder, so it can change without notice. And it
sets `disable-model-invocation: true`, so a scheduled task can't load it.

A finding about the product itself goes to the survey that owns that product area.
This survey only files the reason the session didn't catch it.

## Process

### 1. Select sessions (the re-runnable recipe)

```bash
node scripts/retro-candidates.mjs --since <date>
```

`<date>` is the date the latest `retro` parent issue was opened. On the first run,
use seven days ago. The script lists every PR opened since then that names its
session, and maps each PR to its session from either of two places: the
`claude.ai/code/session_…` link in the PR body, or the `Claude-Session:` trailer in
its commits. It tags each PR with the signals it can read from GitHub:

| Signal | Read from |
|---|---|
| `red-ci` | a failed Actions run on the PR's head branch |
| `not-run` | the PR body says it did not run, re-run, re-measure, verify or test something |
| `follow-up` | another PR in the window fixes the same issue, or the title says follow-up |
| `reverted` | a later PR titled `Revert "<this title>"` |
| `abandoned` | closed without merging |

**Asked why a survey missed something?** Skip the script: read the sessions that
ran that survey. Its parent issue links the survey-file PR, whose body carries
the session id (precedent: #1372).

Read the **worst-tagged 5 to 10 sessions** and skip the clean ones. A `not-run`
that only says "no source changed, so build was skipped" is noise. A `not-run`
that skips a finding's acceptance check is not noise. Before #1308, every session
is hand-started, so the script's population is "every session PR". Once
dispatched sessions carry a marker, narrow the script to that marker.

### 2. Read each session

Read with `mcp__claude-code-remote__list_events`, not from disk. Cloud sessions
are reclaimed, and their logs aren't kept on the machine. Pass
`kinds: ["user","assistant","result"]` and `limit: 100`. A result that is too big
is saved to a file. Don't slice that file by hand. Condense it to one line per
tool call:

```bash
node scripts/session-digest.mjs <saved-file>   # ~300 KB transcript -> ~6 KB
```

Results under the size limit come back inline and cost full context, so read
those sessions last. The newest page usually holds the CI failure and the
user's correction. Page further back with `before_id` set to `first_id` only
when the cause happened earlier. A survey session's newest pages are PR
babysitting; its survey work sits 4–5 pages back. `RESULT` lines carry turns, cost and permission
denials. Use the user's correction ("The build failed in CI") as the anchor:
find what the session did just before it.

### 3. Report

Only after both steps. Tally the causes across sessions before writing anything.
A cause seen in three sessions outranks a vivid one seen in one.

## Budget

- 5 to 10 sessions per run, chosen by step 1.
- `CLAUDE.md` in full, every run. It is in the context of every turn of every
  session, so its size is a cost all sessions pay. The other surveys only ever
  add to their own skill files, and nothing else trims `CLAUDE.md`. Record its
  byte count in the coverage statement, so the next run can compare.
- The gates as configured: `package.json` scripts, `.github/workflows/build.yml`,
  `eslint.config.js`, `.dependency-cruiser.mjs`, `.github/pull_request_template.md`.
- The survey files only where a session ran a survey.

## Output structure

File the run per the [shared reporting conventions](../_survey/conventions.md#reporting),
with `retro` as the survey-type label.

1. **Verdict** (~5 sentences): what most often made sessions go wrong, and the
   one change that would have prevented the most of it.
2. **Coverage statement:** the `--since` date, the candidate count and signal
   tally, the sessions read (PR → session id → signals), and `CLAUDE.md`'s byte count.
3. **Category verdicts:** one line per category below.
4. **Findings — top 5.** The [shared finding fields](../_survey/conventions.md#finding-fields),
   plus:
   - **Sessions** — the PRs/session ids it was seen in, and what happened in each
     (one line, with a verbatim quote from the transcript or PR).
   - **Category** — one of the tags below. Label only `retro` + `survey-finding` + the tier.
   - **Impact** — 1–10, where 10 = it already shipped a wrong change that no
     check caught; 5 = it costs a red CI round or a follow-up session each time
     it fires; 1 = wasted tokens only.

Breadth here is **sessions affected** of those read, not files.

**Fails silently here** means a steering-file edit that no session follows. It
passes every check by construction. So prefer a fix that a gate enforces over
prose. Example hazard note: "Sonnet 5 if the exact `CLAUDE.md` lines to cut are
listed; else Opus 5, since a cut that drops a rule sessions relied on is
invisible until a session breaks it."

## Categories — ranked by priority

### 1. Automated checks (`checks`)
Did CI fail on something a local command would have caught, or could a new check
catch a mistake the session made? Read the repo's own scripts and workflow first.
A check that exists but that sessions don't run is the finding. Rebuilding that
check is not.

### 2. Coding standards (`standards`)
There is no `CODING_STANDARDS.md` and no reviewer agent here. The standards are
the ESLint boundary rules, dependency-cruiser, the PR template's definition of
done, and `CLAUDE.md`. A mechanical violation (an import shape, a file location, a
banned API) needs a lint rule or a test. Leave prose for judgement calls only. Two
gates that contradict each other are a finding too.

### 3. Steering-file size (`steering`)
Which `CLAUDE.md` sections could move to a doc or skill behind a one-line pointer?
A section belongs in `CLAUDE.md` only if most sessions need it on most turns.

### 4. No-ops (`no-op`)
Instructions that don't change what sessions do: rules for tools that cloud
sessions don't have, history that explains an old mistake, or a rule a gate
already enforces. Cite a grep over the transcripts you read that shows the
instruction never came into play.

### 5. Navigation (`navigation`)
Did a session spend many calls finding a file, or miss a hidden dependency (two
PRs racing, a convention that lives in a file it never read)?

### 6. Tool economy (`tool-economy`)
Expensive calls that a cheaper route would have answered, such as a whole issue
tree read to learn whether its sub-issues are closed, or a full docs page fetched
for one fact.

### 7. Information access (`info-access`)
A fact the session needed but couldn't get, such as CI logs, a browser, or a
service. Say what would give it access.
