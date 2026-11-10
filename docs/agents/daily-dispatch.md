# Daily dispatch

Run by the daily scheduled task ("Daily dispatcher"); the task's prompt only
says to follow this file. Goal: open findings move forward without anyone
starting sessions by hand, and the maintainer's part comes down to one twice-weekly
digest issue, which also says why anything isn't moving.

0. Run `node scripts/workshop-pause.mjs` first and act on its `state` as
   `docs/agents/workshop-pause.md` says. Anything but `normal` ends this
   procedure.
1. `node scripts/workshop-dispatch.mjs` is the **dry run**: it prints the plan as
   JSON and writes nothing. Read it before applying.
2. `node scripts/workshop-dispatch.mjs --apply` claims what the plan starts
   (assigns each dispatched issue and leaves a `workshop-dispatch` marker comment;
   leaves a `workshop-followup` marker comment on each followed-up PR), labels
   PRs with their merge policy, merges the `automerge` PRs, closes finished
   survey parents, rewrites the draft digest and publishes it when due. It
   prints the same plan.
3. For each entry in `sessions`, start one background subagent with the
   `Agent` tool: the entry's `prompt`, `description` from its `title`,
   `model` set to its `tier`, and `isolation: "worktree"`, so each works in its
   own checkout with its own context. A `followup` entry's prompt names the
   PR branch to work on. Start them all, then wait for every one to finish
   before ending the run. (Scheduled runs have no `create_session`; subagents
   are how one run fans out.)
4. For each entry in `digest.replies` (the maintainer replying on the
   digest), copy the decision onto the issue or PR it is about, as a comment
   linking the reply, and remove `decision-required` if it settles one. Skip
   a reply already copied there. Then comment `<!-- workshop-relayed -->` on
   that digest issue (with the footer) so the next run doesn't relay it again.
   A reply that names no item gets an answer on the digest instead.
5. Don't subscribe to PR activity, yours or the sessions'. Tomorrow's run is
   the follow-up. Don't open PRs or issues yourself beyond what the script
   writes and what the subagents open.
6. If `sessions`, `automerge` and `digest.replies` are empty, stop. Post nothing.

## What the script decides

- **Dispatch**: open issues that have a `haiku`/`sonnet`/`opus` label, no
  `opus-plan`, `decision-required` or `deferred`, no assignee, no open blocker (native, or named in the body by a `Blocked by: #n` line or `## Blocked by` section), no
  sub-issues, and no open PR that closes them. Oldest first. Every other open
  issue is either somewhere else in the digest (its PR, Decide, Unstick) or
  under **Not picked up** with its reason (no tier label, `opus-plan`, `deferred`, blocked
  by `#N`, assigned by hand, a survey run whose open findings all wait on a
  decision), so nothing is skipped silently.
- **Follow-up**: every open, non-draft PR (Dependabot's as `opus`, one with no
  tier-labelled issue as `sonnet`), once CI
  has finished. A PR gets one narrow session if it conflicts with `main`
  (checked without waiting for CI, since GitHub runs none on a conflicting PR;
  the session merges `main` in and pushes; an "unknown" mergeability is
  skipped until the next run), has a failing check or
  review feedback newer than its head commit that isn't an agent's (no Claude
  Code footer). It waits while a follow-up is newer than the head commit.
  Green, quiet PRs cost nothing.
- **Auto-merge**: the `automerge` label on the PR is the only condition, and
  whoever opens the PR sets it: a dispatched session for a `haiku`/`sonnet`
  issue, a survey run for its learnings PR, anyone else deliberately. A green,
  quiet `automerge` PR is merged by the script, pinned to the head commit it
  checked; any other green, quiet non-draft PR goes in the digest's Review
  list. Add or remove the label to override.
  Dependabot PRs aren't merged by the script either:
  `dependabot-automerge.yml` queues non-majors, and drops auto-merge once
  anyone but Dependabot pushes (a follow-up, a merge of `main`); a green PR
  without auto-merge (a major, or one an agent changed) goes in the Review list.
- **Caps**: at most `--max-sessions` (4) sessions per run, follow-ups first;
  at most `--max-followups` (2) follow-ups per PR. After that the PR goes in
  the digest instead.
- **Survey parents**: a survey run's parent issue is closed once every
  finding sub-issue is closed. One whose open findings are all
  `decision-required` or `deferred` is listed under **Not picked up**.
- **Digest**: a draft issue, `Workshop digest (draft) — from <date>`, is
  rewritten on every run (an edit notifies nobody), so it always shows
  today's state: what waits on the maintainer,
  each line saying what to do, PRs first: **Review** (green, quiet
  `needs-review` PRs and Dependabot PRs without auto-merge), **Unstick** (PRs
  at their follow-up cap, conflicts included, a follow-up with no push after 2
  days, a dispatched issue with no PR after 2 days), then **Decide** (open
  `decision-required` issues not blocked by another), each saying which issues
  it unblocks; then what's coming, **Queue** (dispatchable
  issues past today's cap) and **Not picked up**, where issues blocked,
  `deferred` or a survey run waiting on its findings are only counted, in a
  collapsed list, since they'd repeat every time; then, also collapsed, what merged since the
  draft opened, each PR with the issue it closed and its labels. Once the
  first run on a Tuesday or Friday comes (the day after each Monday/Thursday
  survey start, so it carries that survey's findings; `DIGEST_WEEKDAYS` in the
  script, kept in step with that task's schedule) and something merged or
  waits, the run publishes it
  (retitles it `Workshop digest — <publish date>`, cuts the draft note down to where to answer, and comments the counts, the ping),
  closes the previously published digest with a link, and opens the next
  draft. A quiet cycle stays a draft. Replies on the draft or the published
  digest are relayed (step 4). Nothing is decided on silence.

To re-dispatch a stuck issue, unassign it. To stop a PR from getting
follow-ups or keep it out of the workshop entirely, mark it draft. To hold a PR
the workshop would merge, remove its `automerge` label; add it to let one merge.
