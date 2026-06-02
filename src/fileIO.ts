import { serializeRawNode } from './model/inheritance'
import type { RawNode } from './model/nodeSchema'

// ── FileSystem API type extensions ────────────────────────────
// These methods exist in all modern browsers but aren't yet in TypeScript's
// built-in DOM lib (as of TS 5.8).
declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle]>
    queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  }
}

// ── YAML parser ───────────────────────────────────────────────

export function yamlParseScalar(v: unknown): boolean | number | string | null | unknown[] {
  const s = String(v).trim()
  if (s === '') return ''
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean).map(yamlParseScalar)
  return s.replace(/^["']|["']$/g, '')
}

function yamlIndent(line: string): number {
  let n = 0
  while (n < line.length && line[n] === ' ') n++
  return n
}

export function yamlParse(text: string): Record<string, unknown> {
  const lines = text.split('\n').filter(l => l.trim() !== '' && !l.trim().startsWith('#'))

  function parseBlock(startIdx: number, baseIndent: number): [unknown, number] {
    if (startIdx >= lines.length) return [null, startIdx]
    const firstLine = lines[startIdx]
    const indent = yamlIndent(firstLine)
    if (indent < baseIndent) return [null, startIdx]

    if (firstLine.trim().startsWith('- ')) {
      const items: unknown[] = []
      let i = startIdx
      while (i < lines.length) {
        const line = lines[i]
        const lineIndent = yamlIndent(line)
        if (lineIndent < indent) break
        if (lineIndent === indent && line.trim().startsWith('- ')) {
          const item: Record<string, unknown> = {}
          const rest = line.trim().slice(2)
          const m = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
          if (m) {
            const key = m[1], val = m[2]
            if (val.trim() === '') {
              const [v, nextI] = parseBlock(i + 1, indent + 2)
              item[key] = v
              i = nextI
            } else {
              item[key] = yamlParseScalar(val)
              i++
            }
          } else {
            i++
          }
          while (i < lines.length) {
            const cl = lines[i]
            const ci = yamlIndent(cl)
            if (ci <= indent) break
            const km = cl.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
            if (km) {
              const ckey = km[1], cval = km[2]
              if (cval.trim() === '') {
                const [v, nextI] = parseBlock(i + 1, ci + 2)
                item[ckey] = v
                i = nextI
              } else {
                item[ckey] = yamlParseScalar(cval)
                i++
              }
            } else {
              i++
            }
          }
          items.push(item)
        } else {
          break
        }
      }
      return [items, i]
    }

    const dict: Record<string, unknown> = {}
    let i = startIdx
    while (i < lines.length) {
      const line = lines[i]
      const lineIndent = yamlIndent(line)
      if (lineIndent < indent) break
      if (lineIndent > indent) { i++; continue }
      const m = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
      if (!m) { i++; continue }
      const key = m[1], val = m[2]
      if (val.trim() === '') {
        const [v, nextI] = parseBlock(i + 1, indent + 2)
        dict[key] = v
        i = nextI
      } else {
        dict[key] = yamlParseScalar(val)
        i++
      }
    }
    return [dict, i]
  }

  const [result] = parseBlock(0, 0)
  return (result as Record<string, unknown>) || {}
}

// ── Frontmatter split / merge ─────────────────────────────────

/** CRLF-aware frontmatter split — canonical for the whole codebase. */
export function splitFrontmatter(content: string): { fm: string; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m) return { fm: m[1], body: m[2].trim() }
  return { fm: content, body: '' }
}

/** Wrap serialised YAML fields with --- delimiters and append markdown body. */
export function wrapFrontmatter(yamlFields: string, body: string): string {
  return `---\n${yamlFields}\n---${body ? '\n\n' + body : ''}`
}

// ── File parse / serialise ────────────────────────────────────

/** Parse raw file content to a plain object + body, without any domain typing. */
export function loadFile(
  path: string,
  content: string,
): { rawNode: Record<string, unknown>; body: string; path: string } {
  let fm: string
  let body: string
  const hasFrontmatter = /^---\r?\n/.test(content)
  if (hasFrontmatter) {
    ;({ fm, body } = splitFrontmatter(content))
  } else if (path.endsWith('.md')) {
    fm = ''
    body = content.trim()
  } else {
    fm = content
    body = ''
  }
  const rawNode = fm ? yamlParse(fm) : {}
  return { rawNode, body, path }
}

/** Serialise a raw node to a YAML frontmatter file string. */
export function saveFile(rawNode: Record<string, unknown>, body: string): string {
  return wrapFrontmatter(serializeRawNode(rawNode as RawNode), body)
}

// ── Filename utility ──────────────────────────────────────────

export function titleToSlug(title: string): string {
  return (title || 'untitled')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled'
}

// ── FileSystem API ────────────────────────────────────────────

export async function diskPickDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error('Your browser does not support folder access. Use Chrome or Edge, and open this file directly (not in a preview).')
  }
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if ((e as Error).name === 'SecurityError') {
      throw new Error('Folder access is blocked here. This happens inside embedded previews. Save this HTML file and open it directly in Chrome or Edge.')
    }
    throw e
  }
}

export async function diskReadAll(
  dh: FileSystemDirectoryHandle,
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = []
  for await (const [name, fh] of dh.entries()) {
    if (!name.endsWith('.md') && !name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    try {
      const file = await fh.getFile()
      const content = await file.text()
      results.push({ path: name, content })
    } catch (e) { console.warn('[storage] could not read', name, e) }
  }
  return results
}

export async function diskWrite(
  dh: FileSystemDirectoryHandle,
  path: string,
  content: string,
): Promise<void> {
  const perm = await dh.queryPermission({ mode: 'readwrite' })
  if (perm !== 'granted') {
    const ask = await dh.requestPermission({ mode: 'readwrite' })
    if (ask !== 'granted') throw new Error('Write permission denied')
  }
  const fh = await dh.getFileHandle(path, { create: true })
  const w = await fh.createWritable()
  await w.write(content)
  await w.close()
}

export async function diskDelete(
  dh: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  try { await dh.removeEntry(path) } catch { }
}
