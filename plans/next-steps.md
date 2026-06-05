## Next steps

- Adapt EntryEditor to have tags directly below title, then a separator, then the scope selector and then the type select, so it matches root / occurrence split
- Fix look of multiday events. We want something like in Google Calendar: Render like a normal event but have '(Day 1/3)' suffixed.
- Fix swiping to the right after swiping to the left
- Fix allday events being shown gray instead of purple
- Make done tasks less prominent. The bright green checkmark is a bit distracting.

From the first architecture / tech debt survey (maintainability, security, code duplication, architecture smells, styling consistency, UX bad practices, directory/file layout, domain separation):

1. Occurrence IDs are regenerated on every expansion → fragile matching everywhere
   expandRange calls crypto.randomUUID() for every occurrence on every render (expansion.ts:643, and 5+ other sites). The comment in storeOps.ts:51 admits the consequence: occ.id never matches a store item, so the whole edit layer falls back to matching on (fileSlug, date) tuples. That's a structural smell — it makes overrides positionally fragile (two items same file+date collide) and defeats React keys. Derive a stable occurrence id (e.g. ${fileSlug}|${date}|${time}) so identity is meaningful and the (fileSlug,date) workarounds can go.

2. meridian.ts is an 845-line god-module, and ships mock data to production
   meridian.ts mixes: seed YAML, storage/sync, directory-handle lifecycle, navigation, occurrence sorting, three different CSS-class color mappers, the mutation API, and the toast manager. Split it (storage, navigation, presentation/sorting, mutations). Notably, NOTES_DATA (meridian.ts:393) is hardcoded fake notes ("Reading List", "SICP") that are bundled into production and actually surface in the wikilink autocomplete (EntryEditor.tsx:143) — users will see phantom notes that don't exist. Remove it from real autocomplete.

3. The debug tooling is bundled and deployed to production
   vite.config.ts:97 lists debug.html as a Rollup input, so the 796-line NodeInheritanceDebugger.tsx — the largest single source file — is built and published to GitHub Pages alongside the app. It exposes internal model structure and bloats the deploy. Gate it behind dev-only (if (import.meta.env.DEV)) or a separate non-deployed config.

4. as any and duck-typing pervade the core engine
   The most critical module leans on Record<string, any> and as any throughout (expansion.ts:222, expandNode, mergeNode, the expandRange cast at line 625), plus setPrimary(v as any) / pushOverlay(v as any) in meridian.ts:38 and (window as any).\_focusSearch global (SearchView.tsx:36). TypeScript is providing little safety exactly where the logic is hardest. Tighten the OccurrenceEntry/node types so the engine is type-checked; replace the window global with a ref or store action.

5. In-place state mutation + DOM-driven navigation
   toggleOccDone does o.metadata.done = !o.metadata.done (meridian.ts:584), mutating a store object in place before the immutable update — an anti-pattern with React/Zustand that can cause stale renders. Separately, navigation relies on document.querySelector('.day-section[...]') + setTimeout with magic delays (60/100/200ms) in goToday and App.tsx:98 — racy and fragile. Prefer refs/scrollIntoView driven by React, and never mutate store state directly.

From the schema title / tags / topics PR:

1. The root node is a root: true flag on OccurrenceEntry, not a real type.
   I did this deliberately to avoid churning the StoreItem union and every .date access — but it's a modeling smell. A root node has date: '', time: null, source: 'explicit' — all meaningless. And every "standalone" filter now needs && !isRootNode(i); forget it in new code and a root node silently leaks into expansion/collapse/render. Cleanest fix: a proper discriminated StoreItem variant (or a separate roots map on the store), with typed guards that actually narrow.

2. AppMetadata forces title: string on items where it's meaningless.
   This is the root cause of several hacks: withoutFileLevel sets title: '' (rather than omitting it), collapse still has to omitFileLevel/pickFileLevel to keep those empty strings from serializing, and there are as AppMetadata casts. A clean split — OccurrenceMetadata (no file-level) vs FileMetadata (file-level only, on the root node) — would delete most of that and make the model self-documenting.

3. Dual raw-vs-expanded representation is an undocumented invariant.
   item.metadata.title is '' on raw store items but populated on expanded occurrences (via the expandRange join). That's a real footgun — the scattered isRootNode redirects (resolveWikilink, the editor autocomplete, body persistence) all exist because of it. Worth at least a documented invariant, ideally enforced by the type split in #2.

4. expandRange mints a fresh crypto.randomUUID() per occurrence on every call.
   So occurrence ids are never stable, which is why mutations match by (fileSlug, date) instead of id (see the comment in upsertOverride). Fragile — e.g. two occurrences on the same date/file can't be distinguished — and it'll complicate backlinks/linking later.

5. buildBodyHtml + entryFromOccurrence's bodyTransform/bodyHtml param are legacy from the contentEditable editor — dead-ish weight, already slated for removal in the CM6 PR.
