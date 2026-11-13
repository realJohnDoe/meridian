# Weekly survey start

Run twice a week by the scheduled task "Start top-ranked survey"; the task's
prompt only says to follow this file. Goal: survey cadence without anyone
remembering, and no new findings while earlier ones are still open.

No workshop pause check: step 1's gate limits a pause to at most one run,
since paused findings don't get worked. Disable the task by hand to stop even
that.

1. **Count the open survey findings** (issues labelled `survey-finding`; other
   issues don't count):

   ```bash
   gh api --paginate "repos/realJohnDoe/meridian/issues?labels=survey-finding&state=open&per_page=100" \
     --jq '[.[] | select(.pull_request|not)] | length' \
     | awk '{s+=$1} END {print s}'
   ```

   **3 or more → stop. Post nothing, open nothing.**
2. **Close finished parents.** Every open issue labelled `survey` with
   sub-issues and none of them open gets a comment linking its findings (`#n` each), then
   is closed as completed:

   ```bash
   gh api --paginate "repos/realJohnDoe/meridian/issues?labels=survey&state=open&per_page=100" \
     --jq '.[] | select(.pull_request|not) | select(.sub_issues_summary.total>0 and .sub_issues_summary.total==.sub_issues_summary.completed) | .number'
   ```

   Then `node scripts/survey-next.mjs` (un-shallows itself; needs `gh`). Rows marked
   `-` are unranked, skip them.
3. Walk the ranked rows in order. **Skip** a row if its score is `0` (fresh) or
   its survey already has an open parent issue with open findings that the
   workshop can still work. Findings that are `decision-required` or `deferred`
   don't count, so one parked decision doesn't block the survey for good (the
   dispatcher lists them under **Decide**). For each open
   parent:

   ```bash
   gh api "repos/realJohnDoe/meridian/issues?labels=<label>&state=open&per_page=100" \
     --jq '.[] | select(.pull_request|not) | select(.sub_issues_summary.total>.sub_issues_summary.completed) | .number'
   gh api "repos/realJohnDoe/meridian/issues/<parent>/sub_issues?per_page=100" \
     --jq '[.[] | select(.state=="open") | select([.labels[].name] | any(. == "decision-required" or . == "deferred") | not)] | length'
   ```

   `<label>` is the survey's `label:` frontmatter key; skip the row if any
   parent's count is above 0. Take the first row that survives.
4. **None survives → stop. Post nothing, open nothing.**
5. Run that survey's skill (`.claude/skills/<survey>/SKILL.md`; for a health row
   `(test code)`, the test-code corpus). Its parent issue's body must open with
   a **Why this survey** line: the script's last-run date, days, PR count and
   score for the row, and that it ranked first.
