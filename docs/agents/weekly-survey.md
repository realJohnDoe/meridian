# Weekly survey start

Run by the weekly scheduled task ("Start top-ranked survey"); the task's prompt
only says to follow this file. Goal: survey cadence without anyone remembering.

1. `node scripts/survey-next.mjs` (un-shallows itself; needs `gh`). Rows marked
   `-` are unranked, skip them.
2. Walk the ranked rows in order. **Skip** a row if its score is `0` (fresh) or
   its survey already has an open parent issue with open findings:

   ```bash
   gh api "repos/realJohnDoe/meridian/issues?labels=<label>&state=open&per_page=100" \
     --jq '.[] | select(.pull_request|not) | select(.sub_issues_summary.total>.sub_issues_summary.completed) | .number'
   ```

   `<label>` is the survey's `label:` frontmatter key. Take the first row that
   survives.
3. **None survives → stop. Post nothing, open nothing.**
4. Run that survey's skill (`.claude/skills/<survey>/SKILL.md`; for a health row
   `(test code)`, the test-code corpus). Its parent issue's body must open with
   a **Why this survey** line: the script's last-run date, days, PR count and
   score for the row, and that it ranked first.
