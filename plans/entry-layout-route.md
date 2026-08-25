# Give the entry routes their own layout route

Implementation plan for removing the two-mode app shell introduced by
[#808](https://github.com/realJohnDoe/meridian/pull/808), by making the entry
routes a sibling layout instead of children of `_app`.

**Status: not started.** Prerequisite
[#808](https://github.com/realJohnDoe/meridian/pull/808) shipped;
[#811](https://github.com/realJohnDoe/meridian/pull/811) (three follow-up bug
fixes to the flow shell) should land first — this plan deletes the mechanism
those fixes patch, and several files named below (`src/lib/topChrome.ts`,
`src/lib/floatingPlacement.test.ts`) arrive with it.

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
URLs are provably unchanged (see PR 2), and the deletions are mechanical. What
the work needs is care with *sequencing* — PR 1 exists solely to make PR 2 safe —
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
PR1 ──► PR2 ──► PR3
                PR4 ─ (independent, any time)
```

| # | Title | Model | Est. | Deletes |
|---|---|---|---|---|
| 1 | Move the vault-changed subscription to the root route | Sonnet 5 | 0.5d | — |
| 2 | `_entry` layout route; entry routes move under it | Sonnet 5 | 1–1.5d | the topbar portal |
| 3 | Delete the two-mode shell | Sonnet 5 | 0.5–1d | `useShellMode`, `data-shell*`, `shellPanes.test.ts` |
| 4 | One `findScrollParent` | Sonnet 5 | 0.5d | a duplicate implementation |

---

### PR 1 — Move the vault-changed subscription to the root route

**Model: Sonnet 5** · 0.5d · no user-visible change

**This PR exists to make PR 2 safe. It ships on its own and changes nothing
today.**

`src/routes/_app.tsx`'s `AppMain` registers:

```ts
useEffect(() => onVaultChanged(({ contentReplaced }) => {
  ...
  resetCalendarOnVaultChange()
```

Its own comment states why it lives there:

> Registered here — not in AgendaPage — because AppMain stays mounted across
> every app route: a vault switch made while in the editor, month, day, or a
> list view would otherwise be missed (AgendaPage is unmounted then), leaving
> the next agenda visit to restore a stale, cross-vault offset near the top.

PR 2 moves the entry routes out of `_app`, which unmounts `AppMain` while the
editor is open — reintroducing exactly the bug that comment describes. Move the
subscription up to `src/routes/__root.tsx`'s `Root`, which stays mounted across
every route including auth callbacks.

**Steps**

1. Move the `useEffect(() => onVaultChanged(...))` block from `AppMain` to
   `Root` in `__root.tsx`, keeping the comment and updating its first line to
   say the root route is what stays mounted.
2. Move the `onVaultChanged` / `resetCalendarOnVaultChange` imports with it.
   `__root.tsx` already imports from `@/storage` and `@/calendar`, so no new
   module edges.
3. `Root` already has a `useEffect` for sync lifecycle — keep them separate
   rather than merging; they have different dependency shapes.

**Test to add.** `src/routes/__root.test.tsx` exists and has coverage
thresholds (`vitest.config.ts` floors `__root.tsx` at 92% statements). Add a
case asserting that a vault change fires `resetCalendarOnVaultChange` while the
rendered route is *not* the agenda — that is the regression PR 2 would
otherwise introduce, and it must fail if this subscription is ever moved back
down.

**Verify.** `pnpm run build && pnpm run lint && pnpm run test`. Coverage floors
for both `__root.tsx` and `_app*.tsx` must still pass; note `src/routes/_app*.tsx`
is coverage-excluded, so moving logic *out* of it can only help.

---

### PR 2 — `_entry` layout route; entry routes move under it

**Model: Sonnet 5** · 1–1.5d · deletes the topbar portal

**URLs do not change.** `_app` is a *pathless* layout route (leading
underscore), so it contributes no path segment: `_app.entry.$vault.$slug.tsx`
serves `/entry/$vault/$slug`. A new pathless `_entry` serves the same paths.
Confirm after the move by grepping `src/routeTree.gen.ts` for
`fullPath: '/entry/$vault/$slug'` — it must still be there, unchanged.

This is why **no navigation code needs touching**: `src/routes/-entryRoute.ts`
and every `navigate({ to: ... })` call site use *paths* (`to: '/entry/$vault/$slug'`),
not route ids. Only the three `createFileRoute(...)` ids change.

**Steps**

1. **Create `src/routes/_entry.tsx`** — a pathless layout route rendering the
   flow shell directly, with no `SidebarProvider`, no `SearchBar`, and no
   header:

   ```tsx
   export const Route = createFileRoute('/_entry')({ component: EntryLayout })

   function EntryLayout() {
     return (
       <div className="mx-auto w-full bg-background">
         <Outlet />
       </div>
     )
   }
   ```

   Deliberately no `h-*`, no `min-h-0`, no `overflow-hidden` anywhere in this
   subtree — that absence *is* the flow shell. Do not reintroduce
   `data-shell-pane` markers; PR 3 removes them.

2. **Rename the three route files**, changing only the layout prefix:

   | from | to |
   |---|---|
   | `_app.entry.$vault.$slug.tsx` | `_entry.entry.$vault.$slug.tsx` |
   | `_app.entry.$slug.tsx` | `_entry.entry.$slug.tsx` |
   | `_app.entry.new.tsx` | `_entry.entry.new.tsx` |

   and the matching `createFileRoute('/_app/entry/...')` → `createFileRoute('/_entry/entry/...')`.

3. **Render the topbar directly instead of portalling it.** In a flow document
   a `sticky top-0` element at the top of the content sticks with no portal at
   all. Change `-entryTopbar.tsx` to drop `createPortal` and render its own
   `<header className="sticky top-0 z-20 h-topbar pt-[env(safe-area-inset-top)] …">`,
   reusing the classes currently on `_app.tsx`'s header.

   Keep the header's existing `z-10` — do not invent a new value. #811 put
   `isolate` on the card root, which contains the card-local `z-0/10/20` scale
   so it can no longer outrank the chrome; `z-10` is sufficient *because of*
   that, and changing it would silently alter stacking relationships this plan
   has no reason to touch.

4. **Delete `src/routes/-topbarSlot.ts`** and its two imports.

5. **Strip `_app.tsx`.** Remove `isEntryView`, the three `useMatch` calls that
   feed it (`'/_app/entry/$vault/$slug'`, `'/_app/entry/$slug'`,
   `'/_app/entry/new'`), the `TopbarSlotContext` wrapper, the `slotEl` state and
   callback ref, the conditional in the `<header>`, and the `{!isEntryView &&}`
   guard on `<SearchBar />`. `_app`'s header becomes unconditionally
   `<TopbarShell …>`.

6. **Leave `useShellMode` alone in this PR.** `_app` keeps
   `useShellMode('fixed')` and `_entry` sets `'flow'`; PR 3 removes both. Doing
   it here would mean one PR that both moves routes and changes global CSS, and
   a device regression could not be bisected between them.

**Gotchas**

- `-entryTopbar.test.tsx` renders through the portal today; it will need the
  portal expectation removed.
- The TanStack Router plugin regenerates `src/routeTree.gen.ts` on build. It is
  gitignored — do not hand-edit it, and run `pnpm run build` before `pnpm run lint`
  (per the root `CLAUDE.md`, type-aware lint rules resolve types from it).
- `src/routes/_app*.tsx` is coverage-excluded but `_entry*.tsx` is not matched
  by that glob. Either extend the exclusion in `vitest.config.ts` to
  `src/routes/_entry*.tsx` (consistent — these are route registration files) or
  add tests. Prefer extending the exclusion, and say so in the PR body.

**Verify**

- `pnpm run build && pnpm run lint && pnpm run knip && pnpm run test`
- `grep "fullPath: '/entry" src/routeTree.gen.ts` — all three paths unchanged.
- Manually: `/meridian/entry/example/01-start-here` loads, back arrow returns to
  the agenda, and the agenda's sidebar and search bar still work.

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
