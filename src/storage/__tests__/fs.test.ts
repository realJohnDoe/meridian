/**
 * Contract tests for the local (File System Access) backend's CAS behaviour.
 *
 * sync-collision.test.ts already pins these rules — but against a FakeBackend
 * that only *mirrors* GitHub's semantics. These run the same rules through the
 * real `diskWrite`/`diskDelete` on an in-memory `FileSystemDirectoryHandle`
 * stand-in, so a local vault can't quietly implement a weaker contract than
 * `StorageBackend` documents.
 */
import { describe, it, expect } from 'vitest'
import { diskWrite, diskDelete, diskReadAll, diskStatAll } from '@/storage/fs'
import { ConflictError } from '@/storage/conflictError'

// ── In-memory FileSystemDirectoryHandle ────────────────────────
//
// Flat (no subdirectories) — enough for every case here, and getDirectoryHandle
// throws NotFoundError so an accidental nested path fails loudly rather than
// passing for the wrong reason.

type FakeFile = { content: string; lastModified: number }

function notFound(): Error {
  const e = new Error('not found')
  e.name = 'NotFoundError'
  return e
}

interface FakeHandle extends FileSystemDirectoryHandle {
  files: Map<string, FakeFile>
}

function makeHandle(seed: Record<string, FakeFile> = {}): FakeHandle {
  const files = new Map<string, FakeFile>(Object.entries(seed))
  // Distinct, monotonic mtimes so a rewrite always yields a new version token
  // (real writes are millisecond-stamped; a fake clock keeps that reliable).
  let clock = 100_000

  const fileHandle = (name: string): FileSystemFileHandle => ({
    kind: 'file',
    name,
    getFile: async () => {
      const f = files.get(name)
      if (!f) throw notFound()
      return {
        lastModified: f.lastModified,
        size: f.content.length,
        text: async () => f.content,
      }
    },
    createWritable: async () => {
      let buf = ''
      return {
        write: async (chunk: string) => { buf += chunk },
        close: async () => { files.set(name, { content: buf, lastModified: ++clock }) },
      }
    },
  } as unknown as FileSystemFileHandle)

  return {
    kind: 'directory',
    name: 'vault',
    files,
    entries: async function* () {
      for (const name of files.keys()) yield [name, fileHandle(name)]
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getDirectoryHandle: async () => { throw notFound() },
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name) && !opts?.create) throw notFound()
      return fileHandle(name)
    },
    removeEntry: async (name: string) => {
      if (!files.delete(name)) throw notFound()
    },
  } as unknown as FakeHandle
}

/** The token shape diskStatAll/diskReadFiles produce for a seeded file. */
function tokenOf(f: FakeFile): string {
  return `${f.lastModified}:${f.content.length}`
}

// ── write ──────────────────────────────────────────────────────

describe('diskWrite — CAS', () => {
  it('creates a new file when the path is absent (no expectedVersion)', async () => {
    const dh = makeHandle()

    const version = await diskWrite(dh, 'new.md', 'hello', undefined)

    expect(dh.files.get('new.md')!.content).toBe('hello')
    expect(version).toBeDefined()
  })

  it('must not clobber an existing file when no expectedVersion is given', async () => {
    const dh = makeHandle({ 'meeting-notes.md': { content: 'HAND WRITTEN', lastModified: 1000 } })

    await expect(diskWrite(dh, 'meeting-notes.md', 'APP', undefined))
      .rejects.toBeInstanceOf(ConflictError)
    expect(dh.files.get('meeting-notes.md')!.content).toBe('HAND WRITTEN')
  })

  it('overwrites when the expectedVersion matches', async () => {
    const seeded = { content: 'v1', lastModified: 1000 }
    const dh = makeHandle({ 'note.md': seeded })

    const version = await diskWrite(dh, 'note.md', 'v2', tokenOf(seeded))

    expect(dh.files.get('note.md')!.content).toBe('v2')
    expect(version).not.toBe(tokenOf(seeded))
  })

  it('reports a conflict when the file drifted since expectedVersion was captured', async () => {
    const dh = makeHandle({ 'note.md': { content: 'remote edit', lastModified: 9999 } })

    await expect(diskWrite(dh, 'note.md', 'local edit', '1000:2'))
      .rejects.toBeInstanceOf(ConflictError)
    expect(dh.files.get('note.md')!.content).toBe('remote edit')
  })

  it('reports a conflict when expectedVersion is given but the file is gone', async () => {
    const dh = makeHandle()

    await expect(diskWrite(dh, 'note.md', 'local edit', '1000:2'))
      .rejects.toBeInstanceOf(ConflictError)
    expect(dh.files.has('note.md')).toBe(false)
  })

  it('returns a token the next write can CAS against', async () => {
    const dh = makeHandle()

    const v1 = await diskWrite(dh, 'note.md', 'v1', undefined)
    const v2 = await diskWrite(dh, 'note.md', 'v2', v1)

    expect(dh.files.get('note.md')!.content).toBe('v2')
    expect(v2).toBeDefined()
  })
})

// ── delete ─────────────────────────────────────────────────────

describe('diskDelete — CAS', () => {
  it('deletes when the expectedVersion still matches', async () => {
    const seeded = { content: 'content', lastModified: 1000 }
    const dh = makeHandle({ 'a.md': seeded })

    await diskDelete(dh, 'a.md', tokenOf(seeded))

    expect(dh.files.has('a.md')).toBe(false)
  })

  it('honours expectedVersion — a remote edit after the tombstone survives', async () => {
    const dh = makeHandle({ 'a.md': { content: 'EDITED AFTER TOMBSTONE', lastModified: 9999 } })

    await expect(diskDelete(dh, 'a.md', '1000:5')).rejects.toBeInstanceOf(ConflictError)
    expect(dh.files.has('a.md')).toBe(true)
  })

  it('refuses to delete a file the cache never saw (no expectedVersion)', async () => {
    const dh = makeHandle({ 'a.md': { content: 'SECOND WRITER', lastModified: 9999 } })

    await expect(diskDelete(dh, 'a.md', undefined)).rejects.toBeInstanceOf(ConflictError)
    expect(dh.files.has('a.md')).toBe(true)
  })

  it('stays idempotent when the file is already gone', async () => {
    const dh = makeHandle()

    await expect(diskDelete(dh, 'gone.md', '1000:5')).resolves.toBeUndefined()
    await expect(diskDelete(dh, 'gone.md', undefined)).resolves.toBeUndefined()
  })
})

// ── read/stat (token shape the CAS above depends on) ───────────

describe('diskStatAll / diskReadAll', () => {
  it('hand out the same token diskWrite CASes against', async () => {
    const dh = makeHandle({ 'a.md': { content: 'body', lastModified: 1000 }, 'notes.txt': { content: 'x', lastModified: 1000 } })

    const tokens = await diskStatAll(dh)
    const files  = await diskReadAll(dh)

    // Non-markdown is not a vault file — neither listing includes it.
    expect([...tokens.keys()]).toEqual(['a.md'])
    expect(files.map(f => f.path)).toEqual(['a.md'])
    expect(files[0]!.version).toBe(tokens.get('a.md'))

    // And that token is accepted as the CAS precondition.
    await expect(diskWrite(dh, 'a.md', 'updated', tokens.get('a.md'))).resolves.toBeDefined()
  })
})
