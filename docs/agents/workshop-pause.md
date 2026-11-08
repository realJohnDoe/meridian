# Pausing the workshop

The maintainer pauses and resumes the workshop with one label on an open
`Workshop digest` issue, the draft or the published one. Nothing is published
while paused, so both stay open; marker comments go on the draft. State lives on GitHub (the label plus marker comments),
not in any session. `node scripts/workshop-pause.mjs` reads it and prints
`state`; both scheduled tasks run it before anything else.

## Maintainer procedure

- **Pause**: add the `workshop-paused` label to an open `Workshop digest` issue.
- **Resume**: remove the label.

Nothing else. While the subscription is paused, scheduled tasks use nothing;
Dependabot and the scheduled audit keep running.

## States

| `state` | Daily dispatcher | Weekly survey task |
|---|---|---|
| `drain` (label on, no snapshot newer than it) | Drain, once | Does nothing |
| `paused` (label on, snapshot posted) | Exits | Exits |
| `resume` (label off, latest snapshot has no later "resumed" comment) | Resume, once | Does nothing until resumed |
| `normal` | Dispatch as usual | Start the next survey as usual |

A firing while paused costs one read of the digest issue. Each transition
posts its marker comment (`workshop-snapshot`, `workshop-resumed`) last, so a
second firing in the same state sees the new state and does nothing.

## Drain (dispatcher)

1. Dry run: `node scripts/workshop-dispatch.mjs --followups-only` lists what
   would merge and be followed up (`automerge`, `sessions`);
   `node scripts/workshop-pause.mjs` lists what would be deferred, unassigned,
   and the snapshot it would post.
2. `node scripts/workshop-dispatch.mjs --apply --followups-only`: merges green
   PRs, gives red ones their last follow-up, starts no new issue. Run its
   sessions as in `daily-dispatch.md` and wait for them.
3. `node scripts/workshop-pause.mjs --apply`: PRs still red or conflicting are
   converted to draft, labelled `deferred` and commented; `opus` PRs stay open
   for review; issues assigned with no PR are unassigned; the snapshot comment
   (date, main commit, deferred, open decisions, survey ranking) is posted.

## Resume (dispatcher)

1. Dry run: `node scripts/workshop-pause.mjs` lists the deferred PRs to close
   (over 100 commits behind main; their issues return to the dispatcher by
   unassigning), the ones to mark ready again, and the re-checks: the survey
   ranking and the typescript-eslint peer range (the check in `CLAUDE.md`).
2. `node scripts/workshop-pause.mjs --apply` does it and posts the "resumed"
   comment with those findings. If the peer range's upper bound is no longer
   below 7, open a `sonnet` issue to revisit the TypeScript pin. Then continue
   with the normal dispatch; the digest goes out as usual.
