// ── FileSystem API type extensions ────────────────────────────
// These methods exist in all modern browsers but aren't yet in TypeScript's
// built-in DOM lib (as of TS 5.8).
declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  }
}

import { ConflictError } from './conflictError'
import { isVaultFile } from './backend'

// ── Helpers ────────────────────────────────────────────────────

async function collectVaultFiles(
  dh: FileSystemDirectoryHandle,
  prefix: string,
  out: Array<[string, FileSystemFileHandle]>,
): Promise<void> {
  for await (const [name, handle] of dh.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'directory') {
      await collectVaultFiles(handle as FileSystemDirectoryHandle, path, out)
    } else if (isVaultFile(name)) {
      out.push([path, handle as FileSystemFileHandle])
    }
  }
}

async function resolveFileHandle(
  dh: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const parts = path.split('/')
  let dir = dh
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir.getFileHandle(parts[parts.length - 1]!, { create })  // split() always yields ≥1 part
}

/**
 * Current version token for `path`, or `undefined` when it does not exist.
 * Same `${lastModified}:${size}` shape statAll/readFiles hand out, so a token
 * from either can be compared against a fresh stat here.
 */
async function statVersion(
  dh: FileSystemDirectoryHandle,
  path: string,
): Promise<string | undefined> {
  try {
    const fh   = await resolveFileHandle(dh, path)
    const file = await fh.getFile()
    return `${file.lastModified}:${file.size}`
  } catch (e) {
    // The file, or an ancestor directory, is not there — both mean "absent".
    if ((e as { name?: string }).name === 'NotFoundError') return undefined
    throw e
  }
}

async function resolveParentDir(
  dh: FileSystemDirectoryHandle,
  path: string,
): Promise<[FileSystemDirectoryHandle, string]> {
  const parts = path.split('/')
  let dir = dh
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part)
  }
  return [dir, parts[parts.length - 1]!]
}

// ── Public API ─────────────────────────────────────────────────

export function isFolderPickerSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function'
}

export async function diskPickDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFolderPickerSupported()) {
    throw new Error('Your browser does not support folder access. Use Chrome or Edge (desktop or Android), or connect a GitHub repo instead.')
  }
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if ((e as Error).name === 'SecurityError') {
      throw new Error('Folder access is blocked here. This can happen inside an embedded preview or iframe — open Meridian directly, or connect a GitHub repo instead.')
    }
    throw e
  }
}

export async function diskStatAll(
  dh: FileSystemDirectoryHandle,
): Promise<Map<string, string>> {
  const handles: Array<[string, FileSystemFileHandle]> = []
  await collectVaultFiles(dh, '', handles)
  const tokens = new Map<string, string>()
  await Promise.all(
    handles.map(async ([path, fh]) => {
      try {
        const file = await fh.getFile()
        tokens.set(path, `${file.lastModified}:${file.size}`)
      } catch (e) { console.warn('[storage] could not stat', path, e) }
    })
  )
  return tokens
}

export async function diskReadFiles(
  dh: FileSystemDirectoryHandle,
  paths: string[],
): Promise<Array<{ path: string; content: string; version: string }>> {
  const results = await Promise.all(
    paths.map(async path => {
      try {
        const fh   = await resolveFileHandle(dh, path)
        const file = await fh.getFile()
        const content = await file.text()
        return { path, content, version: `${file.lastModified}:${file.size}` }
      } catch (e) {
        console.warn('[storage] could not read', path, e)
        return null
      }
    })
  )
  return results.filter((r): r is { path: string; content: string; version: string } => r !== null)
}

export async function diskReadAll(
  dh: FileSystemDirectoryHandle,
): Promise<Array<{ path: string; content: string; version: string }>> {
  const handles: Array<[string, FileSystemFileHandle]> = []
  await collectVaultFiles(dh, '', handles)
  const results = await Promise.all(
    handles.map(async ([path, fh]) => {
      try {
        const file = await fh.getFile()
        const content = await file.text()
        return { path, content, version: `${file.lastModified}:${file.size}` }
      } catch (e) {
        console.warn('[storage] could not read', path, e)
        return null
      }
    })
  )
  return results.filter((r): r is { path: string; content: string; version: string } => r !== null)
}

export async function diskWrite(
  dh: FileSystemDirectoryHandle,
  path: string,
  content: string,
  expectedVersion?: string,
): Promise<string | undefined> {
  const perm = await dh.queryPermission({ mode: 'readwrite' })
  if (perm !== 'granted') {
    const ask = await dh.requestPermission({ mode: 'readwrite' })
    if (ask !== 'granted') throw new Error('Write permission denied')
  }

  // CAS check — the current token must equal the precondition, and `undefined`
  // is a precondition too: it means *"create"*, so the file must be absent.
  // Both halves matter. Without the token half a remote edit is overwritten;
  // without the absence half a first push of a path the cache has never seen
  // silently clobbers whatever a second writer left there (another device via
  // Dropbox/iCloud/Syncthing, or the user in another editor) — which is what
  // GitHub's Contents API rejects with a 422 on a `PUT` with no `sha`.
  // The local FS is always consistent, so this stat is authoritative (no
  // eventual-consistency lag).
  const cur = await statVersion(dh, path)
  if (cur !== expectedVersion) throw new ConflictError(path)

  const fh = await resolveFileHandle(dh, path, true)
  const w  = await fh.createWritable()
  await w.write(content)
  await w.close()
  // Re-stat so the caller can record the new version token.
  try {
    const file = await fh.getFile()
    return `${file.lastModified}:${file.size}`
  } catch {
    return undefined
  }
}

export async function diskDelete(
  dh: FileSystemDirectoryHandle,
  path: string,
  expectedVersion?: string,
): Promise<void> {
  // CAS check, mirroring diskWrite's. A tombstone survives reloads and may not
  // push until days later, so the file it was staged against can have been
  // edited meanwhile — deleting then destroys content the app never read.
  // An absent file is deliberately not a mismatch: the removeEntry below is
  // idempotent by design (see its catch) and must stay that way.
  const cur = await statVersion(dh, path)
  if (cur !== undefined && cur !== expectedVersion) throw new ConflictError(path)

  try {
    const [dir, name] = await resolveParentDir(dh, path)
    await dir.removeEntry(name)
  } catch (e) {
    // Idempotent delete: the file (or an ancestor directory) is already gone —
    // the desired end state. Treat it as success so a stale tombstone doesn't
    // wedge sync in a permanent retry loop. Any other error is real (e.g. a
    // permission error or a locked file) and must surface to the caller.
    if ((e as { name?: string }).name === 'NotFoundError') return
    throw e
  }
}
