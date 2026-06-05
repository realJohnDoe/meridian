## Next steps

- Adapt EntryEditor to have tags directly below title, then a separator, then the scope selector and then the type select, so it matches root / occurrence split
- Fix look of multiday events
- Fix swiping to the right after swiping to the left
- Fix allday events being shown gray instead of purple

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
