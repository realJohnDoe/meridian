const SUFFIX_RE = /_\d{8}-\d{6}$/

function formatTimestamp(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

/** Return a conflict-copy path for the given `.md` file.
 *  Any existing timestamp suffix is replaced so names never grow. */
export function conflictPath(path: string, when: Date): string {
  const base = path.endsWith('.md') ? path.slice(0, -3) : path
  const stripped = SUFFIX_RE.test(base) ? base.replace(SUFFIX_RE, '') : base
  return stripped + '_' + formatTimestamp(when) + '.md'
}
