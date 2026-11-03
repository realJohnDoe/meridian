#!/usr/bin/env node
// Condenses a saved `list_events` result (kinds user/assistant/result) into one line per
// turn, so survey-retro reads ~5% of a transcript's bytes. See .claude/skills/survey-retro.
// Usage: node scripts/session-digest.mjs <saved-list_events-file> [--width N]
import { readFileSync } from "node:fs";

const [file] = process.argv.slice(2);
const wi = process.argv.indexOf("--width");
const W = wi > 0 ? Number(process.argv[wi + 1]) : 160;
// The saved file wraps one JSON line in an <other-session> envelope; take the JSON.
const json = readFileSync(file, "utf8")
  .split("\n")
  .find((l) => l.trimStart().startsWith("{"));
const { data } = JSON.parse(json).ccr;
const cut = (s) => String(s).replace(/\s+/g, " ").slice(0, W);
const text = (c) =>
  typeof c === "string"
    ? c
    : (c ?? []).map((p) => p.text ?? p.content ?? "").join(" ");

for (const e of data) {
  const t = e.created_at.slice(11, 19);
  const kind = Object.keys(e).find((k) => k !== "created_at");
  const m = e[kind].internal_anthropic_catchall ?? {};
  if (kind === "result") {
    console.log(
      `${t} RESULT turns=${m.num_turns} cost=$${m.total_cost_usd?.toFixed(2)} ${m.subtype} denials=${m.permission_denials?.length ?? 0}`,
    );
    continue;
  }
  const content = m.message?.content;
  if (typeof content === "string") {
    console.log(`${t} USER ${cut(content)}`);
    continue;
  }
  for (const p of content ?? []) {
    if (p.type === "text") console.log(`${t} SAY ${cut(p.text)}`);
    else if (p.type === "tool_use") {
      const i = p.input ?? {};
      const arg = i.command ?? i.file_path ?? i.pattern ?? i.query ?? JSON.stringify(i);
      console.log(`${t} CALL ${p.name} ${cut(arg)}`);
    } else if (p.type === "tool_result") {
      const body = text(p.content);
      console.log(
        `${t} ${p.is_error ? "ERR" : "OK"} ${body.length}ch ${cut(body).slice(0, 100)}`,
      );
    } else if (kind === "user" && p.type !== "image")
      console.log(`${t} USER ${cut(p.text ?? "")}`);
  }
}
