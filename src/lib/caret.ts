/**
 * Character offset of the text nearest (x, y) in viewport coordinates, or
 * null when the browser exposes neither caret API or the point misses a
 * text node entirely (e.g. it lands in padding rather than on a glyph).
 *
 * Tries the standard caretPositionFromPoint first; caretRangeFromPoint is
 * WebKit-only and formally deprecated, but it's still Safari's only way to
 * do this, so it stays as the fallback. Both are declared on Document in
 * the DOM lib but implemented by neither jsdom nor every real browser, so
 * each call is feature-detected rather than assumed to exist.
 */
export function caretOffsetFromPoint(x: number, y: number): number | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y)
    if (!pos || pos.offsetNode.nodeType !== Node.TEXT_NODE) return null
    return pos.offset
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari's only caret-from-point API
  if (typeof document.caretRangeFromPoint === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari's only caret-from-point API
    const range = document.caretRangeFromPoint(x, y)
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null
    return range.startOffset
  }
  return null
}
