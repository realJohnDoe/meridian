// ── FileSystem API type extensions ────────────────────────────
// These methods exist in all modern browsers but aren't yet in TypeScript's
// built-in DOM lib (as of TS 5.8).
declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemHandle {
    readonly kind: 'file' | 'directory'
    readonly name: string
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>
    queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  }
}

import { ConflictError } from './conflictError'

// ── Helpers ────────────────────────────────────────────────────

function isVaultFile(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.yaml') || name.endsWith('.yml')
}

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
  return dir.getFileHandle(parts[parts.length - 1], { create })
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
  return [dir, parts[parts.length - 1]]
}

// ── Public API ─────────────────────────────────────────────────

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

  // CAS check: if the caller supplied an expectedVersion, verify the current
  // file token matches before writing. The local FS is always consistent so
  // this stat is authoritative (no eventual-consistency lag).
  if (expectedVersion !== undefined) {
    try {
      const fhExisting = await resolveFileHandle(dh, path)
      const existing   = await fhExisting.getFile()
      const cur = `${existing.lastModified}:${existing.size}`
      if (cur !== expectedVersion) {
        throw new ConflictError(path)
      }
    } catch (e) {
      // File does not exist yet — mismatch against a supplied expectedVersion.
      if ((e as { name?: string }).name === 'NotFoundError') {
        throw new ConflictError(path)
      }
      throw e
    }
  }

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
): Promise<void> {
  try {
    const [dir, name] = await resolveParentDir(dh, path)
    await dir.removeEntry(name)
  } catch { }
}
