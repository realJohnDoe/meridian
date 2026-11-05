# Daily dispatch

Run by the daily scheduled task ("Daily dispatcher"); the task's prompt only
says to follow this file. Goal: open findings move forward without anyone
starting sessions by hand, and the maintainer's part comes down to one weekly
digest.

0. Run `node scripts/farm-pause.mjs` first and act on its `state` as
   `docs/agents/farm-pause.md` says. Anything but `normal` ends this
   procedure.
1. `node scripts/farm-dispatch.mjs` is the **dry run**: it prints the plan as
   JSON and writes nothing. Read it before applying.
2. `node scripts/farm-dispatch.mjs --apply` claims what the plan starts
   (assigns each dispatched issue and leaves a `farm-dispatch` marker comment;
   leaves a `farm-followup` marker comment on each followed-up PR) and
   merges the `automerge` PRs and writes the digest if it's due. It prints the same plan.
3. For each entry in `sessions`, start one background subagent with the
   `Agent` tool: the entry's `prompt`, `description` from its `title`,
   `model` set to its `tier`, and `isolation: "worktree"`, so each works in its
   own checkout with its own context. A `followup` entry's prompt names the
   PR branch to work on. Start them all, then wait for every one to finish
   before ending the run. (Scheduled runs have no `create_session`; subagents
   are how one run fans out.)
4. Don't subscribe to PR activity, yours or the sessions'. Tomorrow's run is
   the follow-up.
5. If `sessions` and `automerge` are empty and `digest.write` is false, stop. Post nothing.

## What the script decides

- **Dispatch**: open issues that have a `haiku`/`sonnet`/`opus` label, no
  `opus-plan` or `decision-required`, no assignee, no open native blocker, no
  sub-issues, and no open PR that closes them. Oldest first.
- **Follow-up**: open, non-draft PRs that close a tier-labelled issue, survey
  learnings PRs and Dependabot PRs (as `opus`), once CI
  has finished. A PR gets one narrow session if it conflicts with `main`
  (checked without waiting for CI, since GitHub runs none on a conflicting PR;
  the session merges `main` in and pushes; an "unknown" mergeability is
  skipped until the next run), has a failing check or
  review feedback newer than its head commit that isn't an agent's (no Claude
  Code footer). It waits while a follow-up is newer than the head commit.
  Green, quiet PRs cost nothing.
- **Auto-merge**: a green, quiet PR is merged by the script (`automerge` in
  the plan), pinned to the head commit it checked, if it
  closes a `haiku`/`sonnet` issue or is a survey run's process-learnings PR
  (touches only `.claude/skills/survey-*/SKILL.md`). `opus`/`opus-plan` PRs
  are never merged by the script; they go in the digest's Review list.
  Dependabot PRs aren't merged by the script either:
  `dependabot-automerge.yml` queues non-majors, and drops auto-merge once
  anyone but Dependabot pushes (a follow-up, a merge of `main`); a green PR
  without auto-merge (a major, or one an agent changed) goes in the Review list.
- **Caps**: at most `--max-sessions` (4) sessions per run, follow-ups first;
  at most `--max-followups` (2) follow-ups per PR. After that the PR goes in
  the digest instead.
- **Digest**: one issue titled `Farm digest`, listing what is waiting on the
  maintainer, each line saying what to do: **Decide** (open
  `decision-required` issues), **Review** (green, quiet `opus`/`opus-plan`
  PRs and Dependabot PRs without auto-merge), **Unstick** (PRs at their follow-up cap, conflicts included, a follow-up with no push
  after 2 days, a dispatched issue with no PR after 2 days). Below that,
  **Merged since** lists every PR merged since the last digest, with the issue
  it closed and that issue's labels. The body is rewritten, and a comment
  posted, only when something merged or what waits changed, **and** the last
  write was 7 or more days ago. A quiet week sends nothing. Nothing is
  decided on silence.

To re-dispatch a stuck issue, unassign it. To stop a PR from getting
follow-ups, mark it draft.
