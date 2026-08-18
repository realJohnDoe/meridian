/** Schemes safe to navigate to from file- or feed-derived content (e.g. an
 *  `.ics` subscription's `URL` property). Rejects `javascript:` and other
 *  script-executing schemes before render — an `<a href>` fires on
 *  middle-click and context-menu "open in new tab", not just onClick, so the
 *  element must never carry an unsafe href in the first place. */
export function isSafeUrl(url: string): boolean {
  return /^(https?|mailto):/i.test(url)
}
