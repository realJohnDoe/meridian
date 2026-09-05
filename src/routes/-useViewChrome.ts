import { useDayChrome } from './-dayChrome'
import { useWeekChrome } from './-weekChrome'
import { useMonthChrome } from './-monthChrome'
import { useListChrome } from './-listChrome'
import { useAgendaChrome } from './-agendaChrome'
import type { ViewChrome } from './-viewChrome'

/**
 * The composition root for `_app.tsx`'s topbar and quick-nav chrome: the one
 * place that knows all five views exist.
 *
 * That it enumerates them is the point, not a leftover — every adapter has to
 * be named somewhere, and confining that to a single ordering statement with
 * no per-view logic in it is what lets the shell above and the four other
 * adapters beside it stay ignorant of each other. Adding a view is a new
 * `use*Chrome` file plus one line here; no existing adapter changes, and
 * `_app.tsx` doesn't change at all.
 *
 * Each hook runs on every render and answers only about itself, returning
 * null when its own route isn't mounted — so the day/week/month/list/agenda
 * discriminant is asked once per view, by that view, instead of being
 * re-derived per concern by the shell. They are called unconditionally (rules
 * of hooks) and are cheap when inactive: a `useMatch` miss and a couple of
 * store reads. The agenda is last because it is the fallback — it is the view
 * you get when no named route matched, so it never returns null.
 */
export function useViewChrome(): ViewChrome {
  const day = useDayChrome()
  const week = useWeekChrome()
  const month = useMonthChrome()
  const list = useListChrome()
  const agenda = useAgendaChrome()
  return day ?? week ?? month ?? list ?? agenda
}
