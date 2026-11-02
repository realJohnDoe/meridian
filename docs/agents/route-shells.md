# Route shells

There are two layout chains under `routes/`, and which one a route belongs to
is decided by **what the route contains**, not by whether it feels like a
"destination".

| Shell | Routes | For |
|---|---|---|
| `_app` — one screen tall, clips itself | `_app.*` (agenda, day/week/month, unscheduled tasks, notes) | Routes with **virtualized lists**. `useVirtualizer` is element-scoped via `getScrollElement`, so the scroller must be an element, not the document. |
| Document flow | `_entry.*`, `settings.*`, `auth.*` | Routes with **text inputs and no virtualizer**. The document can grow, so the browser lifts a focused input above the on-screen keyboard natively, on every platform. |

Put a route with text inputs under `_app` and it gets neither: `_app` caps its
height so the document can never scroll, so there is no native keyboard
avoidance *and* nothing for the browser to scroll the field into view within.
The field sits behind the keyboard. The failure is silent, mobile-only, and
invisible to every test in `src/`, since jsdom has no layout engine.

This has been got wrong twice. The entry routes started on the app chain,
which is why keyboard avoidance was hand-rolled across six surfaces before
`3de767a` addressed the cause rather than the symptom; `/settings` then
repeated it (PR #840, fixed in #844).

The filename is the whole declaration (`_app.foo.tsx` vs `foo.tsx`), so
`e2e/layout-smoke.spec.ts` checks it in a real browser:

- `findUncoveredRoutes()` walks every leaf file in `src/routes/`, extracts its
  `createFileRoute(...)` path, and fails if it isn't listed in `APP_ROUTES`,
  `FLOW_ROUTES`, or the `ROUTE_COVERAGE_EXEMPTIONS` escape hatch (documented
  inline, e.g. `/auth/callback`, which has no `[data-flow-screen]`/`[data-topbar]`
  host to anchor to).
- Every `APP_ROUTES` entry fails if its own content (`[data-app-content]`)
  renders a text-entry field. What it can't see is a field that only appears
  after an interaction, such as one inside a dialog the route opens.

`routes/-appShell.test.ts` separately pins how `_app`'s cap is expressed.
