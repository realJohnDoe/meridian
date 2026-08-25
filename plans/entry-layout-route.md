# Give the entry routes their own layout route

Implementation plan for removing the two-mode app shell introduced by
[#808](https://github.com/realJohnDoe/meridian/pull/808), by making the entry
routes a sibling layout instead of children of `_app`.

**Status: PR 1 and PR 2 shipped.** Prerequisites
[#808](https://github.com/realJohnDoe/meridian/pull/808) and
[#811](https://github.com/realJohnDoe/meridian/pull/811) shipped as part of
PR 1; PR 2 gave the entry routes their own `_entry` layout route and deleted
the topbar portal. What's left is PR 3 (delete the two-mode shell) and PR 4
(unify `findScrollParent`), so everything named below exists on `main` once
those merge.

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
PR3
PR4 ─ (independent, any time)
```

| # | Title | Model | Est. | Deletes |
|---|---|---|---|---|
| 3 | Delete the two-mode shell | Sonnet 5 | 0.5–1d | `useShellMode`, `data-shell*`, `shellPanes.test.ts` |
| 4 | One `findScrollParent` | Sonnet 5 | 0.5d | a duplicate implementation |

---

### PR 3 — Delete the two-mode shell

**Model: Sonnet 5** · 0.5–1d

With `_app` and `_entry` owning separate wrapper chains, nothing needs to
release a shared one.

**The one genuinely global bit** is `src/index.css`:

```css
html{height:100svh;overflow:hidden;background:var(--backdrop)}
body{height:100%;overflow:hidden;background:var(--backdrop)}
```

That caps the *document*, which no per-subtree class can undo. Invert the
ownership: let the document flow by default, and let `_app` — the shell that
actually wants to be exactly one screen tall — clip itself.

1. `html`/`body` → `min-height:100svh` with default overflow. Drop
   `height:100%`; keep the `--backdrop` background.
2. `#root`, `#app` → `min-height:100svh`, no `height:100%`.
3. `_app`'s outermost wrapper (the `SidebarProvider` in `AppLayout`) gains
   `h-svh overflow-hidden`. The rest of `_app`'s existing `flex-1 min-h-0
   overflow-hidden` chain is unchanged and now caps against that.
4. Delete: `src/hooks/use-shell-mode.ts` + `use-shell-mode.test.tsx`, its barrel
   export, both `useShellMode` call sites, `src/shellPanes.test.ts`, every
   `data-shell-pane` marker (`_app.tsx` ×3, `EntryEditor.tsx` ×2,
   `EntryViewOnly.tsx` ×2), `data-shell-topbar`, and the whole
   `html[data-shell="flow"]` block in `index.css`.
5. `GLOSSARY.md`: remove the **fixed shell vs flow shell** entry and add
   `useShellMode` / `ShellMode` to the retired-names table. `src/glossary.test.ts`
   enforces both halves.

**Watch for.** A document that flows by default may rubber-band on iOS on the
calendar routes even though `_app` clips internally. Test that specifically. If
it is objectionable, the fallback is to keep a *two-rule* `data-shell` toggle
for `html`/`body` only — still a large simplification, since the pane markers,
the row/col axis distinction, and `shellPanes.test.ts` all go regardless. Say in
the PR body which of the two shipped.

**Verify.** Full gate, plus on a device: the agenda does not scroll as a
document, the entry editor does, and the entry topbar stays put while its
content scrolls under it.

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
  where the chrome ends; after PR 2 it resolves `_entry`'s own sticky header
  instead of `_app`'s. It selects on `[data-shell-topbar]`, which PR 3 deletes —
  **retarget it in the same PR** to a stable `data-topbar` hook present on both
  layouts' headers, or panels silently stop avoiding the chrome. Its tests in
  `src/lib/floatingPlacement.test.ts` are pure and will not catch that; add a
  case that `topChromeBottom()` resolves a non-zero value with a header
  rendered.
