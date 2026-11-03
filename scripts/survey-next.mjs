#!/usr/bin/env node
// Ranks the surveys by (days since last run) × (merged PRs touching the survey's scope
// since then). See "Choosing the next survey" in .claude/skills/_survey/conventions.md.
// Usage: node scripts/survey-next.mjs [--today YYYY-MM-DD]
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const REPO = "realJohnDoe/meridian";
const sh = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
const ti = process.argv.indexOf("--today");
const today = new Date(ti > 0 ? process.argv[ti + 1] : Date.now());

// Un-shallow first: a truncated `git log` silently undercounts PRs.
if (sh("git", ["rev-parse", "--is-shallow-repository"]) === "true")
  sh("git", ["fetch", "--unshallow"]);

// Pathspec words, double-quotes allowed for ones with spaces/colons.
const words = (s) =>
  [...s.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const fm = (name) => {
  const head = readFileSync(`.claude/skills/${name}/SKILL.md`, "utf8").split(
    "\n---\n",
  )[0];
  return Object.fromEntries(
    [...head.matchAll(/^([\w-]+): (.*)$/gm)].map((m) => [m[1], m[2]]),
  );
};

// Parent issues of past runs: carry the survey-type label and have sub-issues.
const runs = (label) =>
  sh("gh", [
    "api",
    "--paginate",
    `repos/${REPO}/issues?labels=${label}&state=all&per_page=100`,
    "--jq",
    ".[] | select(.pull_request|not) | select(.sub_issues_summary.total>0) | {title,date:.created_at[:10]}",
  ])
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const rows = [];
const latest = {};
for (const dir of readdirSync(".claude/skills").filter((d) =>
  d.startsWith("survey-"),
)) {
  const f = fm(dir);
  const all = runs(f.label);
  const isTests = (r) => /test code/i.test(r.title);
  const corpora = f["scope-alt"]
    ? [
        ["src", f.scope, (r) => !isTests(r)],
        ["test code", f["scope-alt"], isTests],
      ]
    : [[null, f.scope, () => true]];
  for (const [corpus, scope, match] of corpora) {
    const last = all
      .filter(match)
      .map((r) => r.date)
      .sort()
      .at(-1);
    const name = dir + (corpus ? ` (${corpus})` : "");
    if (!last) {
      rows.push({
        name,
        last: "never",
        days: Infinity,
        prs: "-",
        score: Infinity,
      });
      continue;
    }
    const prs = sh("git", [
      "log",
      "--first-parent",
      "-m",
      `--since=${last}`,
      "--format=%H",
      "--",
      ...words(scope),
    ])
      .split("\n")
      .filter(Boolean).length;
    const days = Math.round((today - new Date(last)) / 864e5);
    rows.push({ name, last, days, prs, score: days * prs, corpus, dir });
  }
  if (f["scope-alt"])
    latest[dir] = all.sort((a, b) => b.date.localeCompare(a.date))[0];
}

// Health alternates its corpus: the one the latest health run used is not next.
for (const r of rows) {
  const l = latest[r.dir];
  if (l && r.corpus === (/test code/i.test(l.title) ? "test code" : "src"))
    r.skip = true;
}
rows.sort((a, b) => !!a.skip - !!b.skip || b.score - a.score);
console.log(
  `history: ${sh("git", ["rev-list", "--count", "HEAD"])} commits, as of ${today.toISOString().slice(0, 10)}`,
);
console.log("rank  survey                       last-run    days  PRs  score");
rows.forEach((r, i) =>
  console.log(
    `${r.skip ? " -  " : String(i + 1).padStart(2) + "  "}  ${r.name.padEnd(27)}  ${r.last.padEnd(10)}  ${String(r.days).padStart(4)}  ${String(r.prs).padStart(3)}  ${r.score}${r.skip ? "  (health alternates: latest run used this corpus)" : ""}`,
  ),
);
