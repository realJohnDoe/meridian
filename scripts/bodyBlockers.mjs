// Issue numbers named as blockers in an issue body: the documented fallback to
// native dependencies (docs/agents/issue-tracker.md), either a `Blocked by: #n, #m`
// line or a `## Blocked by` section of `#n` references.
export const bodyBlockers = (body) => {
  const text = body ?? "";
  const found = [
    ...text.matchAll(/^[ \t>*_-]*blocked by\b[*_]*:.*$/gim),
    ...text.matchAll(/^#{1,6}[ \t]+blocked by\b.*\n((?:(?!#{1,6}[ \t]).*\n?)*)/gim),
  ].flatMap((m) => [...(m[1] ?? m[0]).matchAll(/#(\d+)/g)].map((n) => +n[1]));
  return [...new Set(found)];
};
