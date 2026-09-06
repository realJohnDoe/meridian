# Open product questions

Questions that are the user's to answer, not an agent's — parked here because
the alternative is parking them in a code comment, where no survey will ever
find them.

This exists because `plans/surveys/product-niche.md` section 6 ("The decisions
only you can make") and `data-integrity.md`'s "separate normalization from
corruption, and say which the project intends" both ask a run to surface
exactly this kind of question, and a run cannot surface what it never sees. A
question buried in a comment beside the code that raises it reads as settled.

Add one when a change turns out to hinge on a product decision. Remove it when
the decision is made — and say in the removing commit what was decided.

## Should Meridian write frontmatter into a frontmatter-less note?

Today it does: `collapse.ts`'s `emitExtra` path emits `title: ""` for a note
that had no frontmatter at all, because file-level fields use `inlineFieldEmpty`
rather than the relational rule occurrence fields use. Switching that rule would
stop the emission — but it is not a bug to fix quietly, because the answer
depends on what the product wants to promise about hand-authored files it has
not been asked to change.

- **Evidence:** `src/model/collapse.ts` (the `emitExtra(root.extra, undefined, out)`
  call site and the comment above it); the data-integrity survey's finding #8,
  repro (c).
- **Why it matters:** the README promises hand-created files are picked up. A
  user who writes a plain Markdown note and opens it in Meridian gets a
  frontmatter block they did not author.
- **Options:** (a) keep it — one uniform serialization, no special case;
  (b) don't emit for a root whose source had no frontmatter — preserves the
  file byte-for-byte until the user actually edits a field; (c) don't emit
  empty-valued fields at root at all.
