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

// ── Helpers ────────────────────────────────────────────────────

function isVaultFile(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.yaml') || name.endsWith('.yml')
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
  const tokens = new Map<string, string>()
  for await (const [name, fh] of dh.entries()) {
    if (!isVaultFile(name)) continue
    try {
      const file = await fh.getFile()
      tokens.set(name, `${file.lastModified}:${file.size}`)
    } catch (e) { console.warn('[storage] could not stat', name, e) }
  }
  return tokens
}

export async function diskReadFiles(
  dh: FileSystemDirectoryHandle,
  paths: string[],
): Promise<Array<{ path: string; content: string; version: string }>> {
  const results = await Promise.all(
    paths.map(async name => {
      try {
        const fh = await dh.getFileHandle(name)
        const file = await fh.getFile()
        const content = await file.text()
        return { path: name, content, version: `${file.lastModified}:${file.size}` }
      } catch (e) {
        console.warn('[storage] could not read', name, e)
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
  for await (const [name, fh] of dh.entries()) {
    if (!isVaultFile(name)) continue
    handles.push([name, fh])
  }
  const results = await Promise.all(
    handles.map(async ([name, fh]) => {
      try {
        const file = await fh.getFile()
        const content = await file.text()
        return { path: name, content, version: `${file.lastModified}:${file.size}` }
      } catch (e) {
        console.warn('[storage] could not read', name, e)
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
