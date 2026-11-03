#!/usr/bin/env node
// Lists agent-session PRs created since a date with the signals that they went badly, worst
// first, each mapped to the session that wrote it. Step 1 of .claude/skills/survey-retro.
// Usage: node scripts/retro-candidates.mjs --since YYYY-MM-DD
import { execFileSync } from "node:child_process";

const REPO = "realJohnDoe/meridian";
const si = process.argv.indexOf("--since");
if (si < 0) throw new Error("usage: --since YYYY-MM-DD");
const since = process.argv[si + 1];
// Pages by hand: the session proxy refuses the numeric-id URLs `gh api --paginate` follows.
const gh = (path, jq) =>
  execFileSync("gh", ["api", path, "--jq", jq], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "inherit"],
  })
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const pages = (path, jq, done) => {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = gh(`${path}&per_page=100&page=${page}`, jq);
    out.push(...batch);
    if (batch.length < 100 || done(batch.at(-1))) return out;
  }
};

const SESSION = /session_[A-Za-z0-9]{20,}/;
const prs = pages(
  `repos/${REPO}/pulls?state=all&sort=created&direction=desc`,
  ".[] | {number,title,body:(.body // \"\"),ref:.head.ref,abandoned:(.state == \"closed\" and .merged_at == null),created:.created_at[:10]}",
  (p) => p.created < since,
).filter((p) => p.created >= since);
// The PR body usually carries the session link; otherwise a commit's Claude-Session trailer does.
for (const p of prs) {
  p.session =
    p.body.match(SESSION)?.[0] ??
    gh(`repos/${REPO}/pulls/${p.number}/commits`, ".[].commit.message | tojson")
      .join("\n")
      .match(SESSION)?.[0];
}
const red = new Set(
  pages(
    `repos/${REPO}/actions/runs?status=failure&created=>=${since}`,
    ".workflow_runs[] | .head_branch | tojson",
    () => false,
  ),
);
const fixes = (p) =>
  [...p.body.matchAll(/(?:fix|fixes|close|closes|resolves)\s+#(\d+)/gi)].map(
    (m) => m[1],
  );
const issueCount = {};
for (const p of prs) for (const n of fixes(p)) issueCount[n] = (issueCount[n] ?? 0) + 1;
const revertedTitles = prs
  .map((p) => p.title.match(/^Revert "(.*)"$/)?.[1])
  .filter(Boolean);
const NOT_RUN =
  /\b(did not|didn't|not) (run|re-?run|re-?measured?|verified|tested)\b|\bunverified\b/i;

const rows = prs
  .filter((p) => p.session)
  .map((p) => {
    const s = [];
    if (red.has(p.ref)) s.push("red-ci");
    if (NOT_RUN.test(p.body)) s.push("not-run");
    if (fixes(p).some((n) => issueCount[n] > 1) || /follow-?up/i.test(p.title))
      s.push("follow-up");
    if (revertedTitles.includes(p.title)) s.push("reverted");
    if (p.abandoned) s.push("abandoned");
    return { ...p, s };
  })
  .sort((a, b) => b.s.length - a.s.length || b.number - a.number);

console.log(`${rows.length} session PRs created since ${since} (of ${prs.length} PRs)`);
for (const r of rows)
  console.log(
    `#${r.number}  ${r.session}  ${r.created}  [${r.s.join(",") || "clean"}]  ${r.title}`,
  );
