# Weekly survey start

Run twice a week by the scheduled task "Start top-ranked survey"; the task's
prompt only says to follow this file. Goal: survey cadence without anyone
remembering, and no new findings while the backlog is already full.

0. `node scripts/workshop-pause.mjs`: if `state` is not `normal`, **stop. Post
   nothing, open nothing.** (Resume is the dispatcher's job; this task waits.)
1. **Count the open backlog**: open issues with a model-tier label, not counting
   parent issues (ones with sub-issues):

   ```bash
   gh api --paginate "repos/realJohnDoe/meridian/issues?state=open&per_page=100" \
     --jq '[.[] | select(.pull_request|not) | select((.sub_issues_summary.total // 0) == 0) | select([.labels[].name] | any(. == "haiku" or . == "sonnet" or . == "opus" or . == "opus-plan"))] | length' \
     | awk '{s+=$1} END {print s}'
   ```

   **5 or more → stop. Post nothing, open nothing.**
2. `node scripts/survey-next.mjs` (un-shallows itself; needs `gh`). Rows marked
   `-` are unranked, skip them.
3. Walk the ranked rows in order. **Skip** a row if its score is `0` (fresh) or
   its survey already has an open parent issue with open findings that the
   workshop can still work. Findings that are `decision-required` or `deferred`
   don't count, so one parked decision doesn't block the survey for good (the
   digest lists such parents under **Not picked up**). For each open
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
