# Give the entry routes their own layout route

Implementation plan for removing the two-mode app shell introduced by
[#808](https://github.com/realJohnDoe/meridian/pull/808), by making the entry
routes a sibling layout instead of children of `_app`.

**Status: PR 1, PR 2, and PR 3 shipped.** Prerequisites
[#808](https://github.com/realJohnDoe/meridian/pull/808) and
[#811](https://github.com/realJohnDoe/meridian/pull/811) shipped as part of
PR 1; PR 2 gave the entry routes their own `_entry` layout route and deleted
the topbar portal; PR 3 deleted the two-mode shell. What's left is PR 4
(unify `findScrollParent`), so everything named below exists on `main` once
it merges.

---

## Why

`_app` is a layout the entry routes barely use. Four of its responsibilities
are special-cased away for them, three of which predate the flow shell:

| `_app` provides | the entry routes do |
|---|---|
| `SidebarProvider` + `AppSidebar` | never touch it — no `useSidebar`, no trigger, anywhere under `src/editor/` |
| a `<header>` | replace it with an empty portal target and portal their own topbar back up (`-topbarSlot.ts`) |
| `SearchBar` | suppressed (`{!isEntryView && <SearchBar />}`) |
| the fixed shell | switched off per-route (`useShellMode`) |

The fourth was the expensive one. Because `_app` owns one wrapper chain for
every route, making the entry routes scroll as a document meant *releasing that
shared chain conditionally* — via `data-shell` on `<html>` and `data-shell-pane`
markers read by global CSS. Three bugs came out of that mechanism, all found on
a real device rather than in CI:

- a blanket pane rule that was axis-blind, pinning two row-axis panes to their
  content width (317px of horizontal overflow — fixed in #808)
- card internals painting over the topbar, and combobox panels overrunning it,
  because releasing the clip exposed z-index and placement assumptions that
  clipping had been hiding (fixed in #811)
- `FlipList` losing its scroll pin, because releasing `overflow-y-auto` changed
  what its private `findScrollParent` resolved to (fixed in #811)

None of those are inherent to document-flow scrolling. They are all consequences
of *one chain serving two contradictory layouts*. A route family with its own
layout builds the chain it wants, and none of the mechanism is needed.

The measured spine on an entry route today is ten wrappers deep before content,
nine of which resolve to one of two heights. `_entry` should be able to reach
content in roughly six.

## Model recommendation

**Sonnet 5 for all four PRs.**

Nothing here decides semantics. The target shape is fully specified below, the
URLs are provably unchanged, and the deletions are mechanical. What the work
needs is care with *sequencing* — PR 1 existed solely to make PR 2 safe —
and that sequencing is pinned here rather than left to judgement.

The one thing to slow down on is PR 1's hazard, which is called out inline and
has a test to write. Do not reorder the PRs.

## Keeping this file honest

Per `plans/CLAUDE.md`: **each PR deletes its own section from this file as part
of that PR**, and updates the status line above. When the last section goes,
delete the file. Do not leave shipped steps here marked "done" — a reader must
be able to take what is left as the outstanding work without cross-referencing
git history.

## Ordering

```
PR4 ─ (independent, any time)
```

| # | Title | Model | Est. | Deletes |
|---|---|---|---|---|
| 4 | One `findScrollParent` | Sonnet 5 | 0.5d | a duplicate implementation |

---

### PR 4 — One `findScrollParent`

**Model: Sonnet 5** · 0.5d · independent of PRs 1–3

There are two implementations of the same walk with different contracts:

| | requires current overflow? | fallback |
|---|---|---|
| `src/lib/scrollParent.ts` | yes (`scrollHeight > clientHeight`) | `document.scrollingElement` |
| `src/components/FlipList.tsx` (private) | no — deliberately | `document.scrollingElement` (added in #811) |

The difference in the first column is real and documented: `FlipList` must
resolve a scroller that is not *currently* overflowing. The difference in the
second column was an accident, and cost the FlipList regression in #811.

Unify on one exported function in `src/lib/scrollParent.ts` taking an option
for the overflow requirement:

```ts
export function findScrollParent(
  el: HTMLElement,
  opts?: { requireOverflow?: boolean },   // default true
): HTMLElement | null
```

Delete `FlipList`'s private copy and call the shared one with
`{ requireOverflow: false }`, keeping its comment about why. Add tests for both
modes and for the document fallback — the case that regressed.

---

## What this does not change

- Any URL, or any `navigate()` call site.
- `hooks/use-visual-viewport.ts`. iOS Safari still ships no
  `interactive-widget` support, so the visualViewport corrections stay
  necessary regardless of layout. Do not remove them as part of this work.
- `lib/topChrome.ts` (arrives with #811). Floating panels still need to know
  where the chrome ends; it selects on `[data-topbar]`, present on both
  `_app`'s and the entry routes' headers, so it resolves under either layout.
