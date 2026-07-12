import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { encodeBase64, decodeBase64, mapGitHubError } from '@/storage/githubApi'
import { GitHubBackend } from '@/storage/githubBackend'
import { ConflictError, AuthSyncError, TransientSyncError, isTransientSyncError } from '@/storage/conflictError'

/** Shape of the JSON body GitHubBackend sends for write/delete requests. */
interface WriteRequestBody {
  branch:  string
  sha?:    string
  content: string
}

function parseRequestBody(init: RequestInit): WriteRequestBody {
  return JSON.parse(init.body as string) as WriteRequestBody
}

// ── Base64 helpers ─────────────────────────────────────────────

describe('encodeBase64 / decodeBase64', () => {
  it('round-trips ASCII content', () => {
    const text = 'Hello, world!\nSecond line.'
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })

  it('round-trips non-ASCII (UTF-8) content', () => {
    const text = '# Héllo\n日本語テスト\n🎉 emoji'
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })

  it('decodes base64 with embedded newlines (as returned by GitHub API)', () => {
    const text = 'test content'
    const raw  = encodeBase64(text)
    // GitHub returns base64 with newlines every 60 chars
    const withNewlines = raw.replace(/.{10}/g, '$&\n')
    expect(decodeBase64(withNewlines)).toBe(text)
  })
})

// ── Error mapping ──────────────────────────────────────────────

describe('mapGitHubError', () => {
  function makeErr(status: number) {
    const e = new Error('http error') as Error & { status: number }
    e.status = status
    return e
  }

  it('maps 401 to AuthSyncError',       () => expect(mapGitHubError(makeErr(401))).toBeInstanceOf(AuthSyncError))
  it('maps 403 to AuthSyncError',       () => expect(mapGitHubError(makeErr(403))).toBeInstanceOf(AuthSyncError))
  it('maps 404 to AuthSyncError',       () => expect(mapGitHubError(makeErr(404))).toBeInstanceOf(AuthSyncError))
  it('maps 401 to token message',       () => expect(mapGitHubError(makeErr(401)).message).toMatch(/invalid or expired/i))
  it('maps 403 to access/rate message', () => expect(mapGitHubError(makeErr(403)).message).toMatch(/access denied/i))
  it('maps 404 to not-found message',   () => expect(mapGitHubError(makeErr(404)).message).toMatch(/not found|lacks access/i))
  it('maps 409 to ConflictError',       () => expect(mapGitHubError(makeErr(409))).toBeInstanceOf(ConflictError))
  it('maps 422 to ConflictError',       () => expect(mapGitHubError(makeErr(422))).toBeInstanceOf(ConflictError))
  it('passes through unknown errors',   () => {
    const e = new Error('network failure')
    expect(mapGitHubError(e)).toBe(e)
  })
  it('maps TypeError fetch failure to TransientSyncError', () => {
    const e = new TypeError('Failed to fetch')
    expect(mapGitHubError(e)).toBeInstanceOf(TransientSyncError)
  })
})

describe('isTransientSyncError', () => {
  it('returns true for TransientSyncError', () => {
    expect(isTransientSyncError(new TransientSyncError())).toBe(true)
  })
  it('returns true for TypeError with fetch-failure message', () => {
    expect(isTransientSyncError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientSyncError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isTransientSyncError(new TypeError('Load failed'))).toBe(true)
  })
  it('returns false for AuthSyncError', () => {
    expect(isTransientSyncError(new AuthSyncError('bad token'))).toBe(false)
  })
  it('returns true for Octokit-wrapped RequestError with fetch-failure message', () => {
    // Octokit wraps TypeError: Failed to fetch in its own RequestError (not a TypeError),
    // which has a status property. The message is still "Failed to fetch".
    const wrapped = Object.assign(new Error('Failed to fetch'), { status: 0 })
    expect(isTransientSyncError(wrapped)).toBe(true)
  })
  it('returns false for plain Error with non-network message', () => {
    expect(isTransientSyncError(new Error('something unexpected'))).toBe(false)
  })
})

// ── GitHubBackend — request shapes ────────────────────────────

const BASE_CFG = { owner: 'alice', repo: 'notes', branch: 'main', token: 'ghp_test' }

function makeTreeResponse(blobs: { path: string; sha: string }[]) {
  return {
    tree: blobs.map(b => ({ type: 'blob', path: b.path, sha: b.sha })),
    truncated: false,
  }
}

function makeFileResponse(name: string, content: string, sha: string) {
  return { type: 'file', name, sha, path: name, content: encodeBase64(content) }
}

describe('GitHubBackend', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeJsonResp(body: unknown, status = 200) {
    // Octokit iterates over response.headers, so we must provide a real Headers object.
    const headers = new Headers({
      'content-type': 'application/json',
      'x-ratelimit-remaining': '4999',
    })
    return {
      ok:     status >= 200 && status < 300,
      status,
      headers,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }
  }

  function mockFetch(body: unknown, status = 200) {
    fetchSpy.mockResolvedValue(makeJsonResp(body, status))
  }

  it('statAll uses git trees API (recursive) and filters vault files', async () => {
    mockFetch({
      tree: [
        { type: 'blob', path: 'note.md',      sha: 'sha1' },
        { type: 'blob', path: 'image.png',    sha: 'sha2' }, // non-vault — filtered
        { type: 'blob', path: 'data.yaml',    sha: 'sha3' },
        { type: 'tree', path: 'subdir',       sha: 'sha-dir' }, // dir entry — filtered
        { type: 'blob', path: 'subdir/deep.md', sha: 'sha4' },
      ],
      truncated: false,
    })

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const tokens  = await backend.statAll()

    expect(tokens.size).toBe(3)
    expect(tokens.get('note.md')).toBe('sha1')
    expect(tokens.get('data.yaml')).toBe('sha3')
    expect(tokens.get('subdir/deep.md')).toBe('sha4')
    expect(tokens.has('image.png')).toBe(false)
    expect(tokens.has('subdir')).toBe(false)

    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toContain('/repos/alice/notes/git/trees/main')
    expect(url).toContain('recursive=1')
  })

  it('statAll keys by full path so subdirectory files are not lost', async () => {
    mockFetch(makeTreeResponse([
      { path: 'root.md',          sha: 'sha-root' },
      { path: 'archive/old.yaml', sha: 'sha-old'  },
    ]))

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const tokens  = await backend.statAll()

    expect(tokens.size).toBe(2)
    expect(tokens.get('root.md')).toBe('sha-root')
    expect(tokens.get('archive/old.yaml')).toBe('sha-old')
  })

  it('readFiles fetches each file and decodes content', async () => {
    const content = '# Hello\nWorld'
    mockFetch(makeFileResponse('note.md', content, 'sha1'))

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const files   = await backend.readFiles(['note.md'])

    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('note.md')
    expect(files[0].content).toBe(content)
    expect(files[0].version).toBe('sha1')
  })

  it('write sends PUT with base64-encoded content (new file, no sha)', async () => {
    mockFetch({ content: { sha: 'newsha1' } })

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.write('new.md', '# New note')

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/repos/alice/notes/contents/new.md')
    expect((init.method ?? '').toUpperCase()).toBe('PUT')

    const body = parseRequestBody(init)
    expect(body.branch).toBe('main')
    expect(body.sha).toBeUndefined()
    expect(decodeBase64(body.content)).toBe('# New note')
  })

  it('write sends expectedVersion as sha (CAS write)', async () => {
    mockFetch({ content: { sha: 'updatedsha' } })
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.write('note.md', '# Updated', 'existingsha')

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = parseRequestBody(init)
    expect(body.sha).toBe('existingsha')
    expect(decodeBase64(body.content)).toBe('# Updated')
  })

  it('write without expectedVersion omits sha (new file)', async () => {
    mockFetch({ content: { sha: 'newsha' } })
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.write('new.md', '# New')

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = parseRequestBody(init)
    expect(body.sha).toBeUndefined()
  })

  it('write throws ConflictError on 409', async () => {
    mockFetch({ message: 'Conflict' }, 409)
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await expect(backend.write('note.md', '# Updated', 'stalesha'))
      .rejects.toBeInstanceOf(ConflictError)
  })

  it('write throws ConflictError on 422', async () => {
    mockFetch({ message: 'Unprocessable' }, 422)
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await expect(backend.write('note.md', '# Updated', 'stalesha'))
      .rejects.toBeInstanceOf(ConflictError)
  })

  it('write sends sha when updating an existing file (via statAll)', async () => {
    // Kept for backwards compat: _shas still updated from statAll for delete().
    mockFetch(makeTreeResponse([{ path: 'note.md', sha: 'existingsha' }]))
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.statAll()

    mockFetch({ content: { sha: 'updatedsha' } })
    // Now write passing expectedVersion explicitly (old path via _shas is no longer the route)
    await backend.write('note.md', '# Updated', 'existingsha')

    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    const body = parseRequestBody(init)
    expect(body.sha).toBe('existingsha')
    expect(decodeBase64(body.content)).toBe('# Updated')
  })

  it('delete sends DELETE with current sha', async () => {
    // Populate sha via statAll
    mockFetch(makeTreeResponse([{ path: 'old.md', sha: 'delsha' }]))
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.statAll()

    mockFetch({})
    await backend.delete('old.md')

    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toContain('/repos/alice/notes/contents/old.md')
    expect((init.method ?? '').toUpperCase()).toBe('DELETE')

    const body = parseRequestBody(init)
    expect(body.sha).toBe('delsha')
    expect(body.branch).toBe('main')
  })

  it('delete is a no-op for files with unknown sha', async () => {
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.delete('nonexistent.md')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('delete treats a 404 (already gone on GitHub) as success', async () => {
    // A tombstone replays a delete with a cached blob SHA, but the file was
    // already removed on GitHub — GitHub answers 404. This must resolve cleanly
    // so the stale tombstone can be evicted, not wedge sync in a retry loop.
    mockFetch({ message: 'Not Found' }, 404)
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await expect(backend.delete('gone.md', 'stalesha')).resolves.toBeUndefined()
  })

  it('delete still throws on non-404 errors (e.g. auth)', async () => {
    mockFetch({ message: 'Bad credentials' }, 401)
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await expect(backend.delete('note.md', 'somesha')).rejects.toBeInstanceOf(AuthSyncError)
  })

  it('delete prefers the caller-supplied expectedVersion over a stale _shas cache entry', async () => {
    // statAll populates _shas with a stale sha (simulates GitHub's eventually
    // consistent listing lagging behind a remote edit that landed after).
    mockFetch(makeTreeResponse([{ path: 'note.md', sha: 'stale-from-statall' }]))
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.statAll()

    mockFetch({})
    // Tombstone carries the true base version the local delete derived from.
    await backend.delete('note.md', 'true-base-version')

    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    const body = parseRequestBody(init)
    expect(body.sha).toBe('true-base-version')
  })

  it('delete throws ConflictError when expectedVersion has genuinely diverged (409)', async () => {
    mockFetch({ message: 'Conflict' }, 409)
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await expect(backend.delete('note.md', 'stale-base'))
      .rejects.toBeInstanceOf(ConflictError)
  })

  it('ensurePermission returns granted when push permission is true and branch exists', async () => {
    fetchSpy
      .mockResolvedValueOnce(makeJsonResp({ id: 123, name: 'notes', permissions: { push: true, pull: true, admin: false } }))
      .mockResolvedValueOnce(makeJsonResp({ name: 'main' }))
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    expect(await backend.ensurePermission(false)).toBe('granted')
  })

  it('ensurePermission returns denied when push permission is false (read-only token)', async () => {
    fetchSpy.mockResolvedValueOnce(makeJsonResp({ id: 123, name: 'notes', permissions: { push: false, pull: true, admin: false } }))
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    expect(await backend.ensurePermission(false)).toBe('denied')
  })

  it('ensurePermission returns denied when permissions field is absent', async () => {
    fetchSpy.mockResolvedValueOnce(makeJsonResp({ id: 123, name: 'notes' }))
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    expect(await backend.ensurePermission(false)).toBe('denied')
  })

  it('ensurePermission returns denied when configured branch does not exist', async () => {
    fetchSpy
      .mockResolvedValueOnce(makeJsonResp({ id: 123, name: 'notes', permissions: { push: true, pull: true, admin: false } }))
      .mockResolvedValueOnce(makeJsonResp({ message: 'Branch not found' }, 404))
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    expect(await backend.ensurePermission(false)).toBe('denied')
  })

  it('ensurePermission returns denied on 401', async () => {
    fetchSpy.mockResolvedValueOnce(makeJsonResp({ message: 'Bad credentials' }, 401))
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    expect(await backend.ensurePermission(false)).toBe('denied')
  })

  it('readAll falls back to readFiles for small vaults (below the GraphQL batching threshold)', async () => {
    const makeResp = (body: unknown) => ({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'x-ratelimit-remaining': '4999' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })

    // statAll response (git trees API)
    fetchSpy
      .mockResolvedValueOnce(makeResp(makeTreeResponse([
        { path: 'a.md', sha: 'sha-a' },
        { path: 'b.md', sha: 'sha-b' },
      ])))
      // readFiles responses (two parallel Contents-API fetches — no GraphQL call)
      .mockResolvedValueOnce(makeResp(makeFileResponse('a.md', '# A', 'sha-a')))
      .mockResolvedValueOnce(makeResp(makeFileResponse('b.md', '# B', 'sha-b')))

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const files   = await backend.readAll()

    expect(files).toHaveLength(2)
    expect(files.map(f => f.path).sort()).toEqual(['a.md', 'b.md'])
    expect(fetchSpy).toHaveBeenCalledTimes(3) // tree + 2 Contents requests, no /graphql
  })

  // ── readAll — GraphQL batching (large vaults) ──────────────────────────

  function makeGraphQLResp(repository: Record<string, { text: string | null } | null>) {
    const body = { data: { repository } }
    return {
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'x-ratelimit-remaining': '4999' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }
  }

  /** Builds an N-file tree + matching name/content pairs, e.g. note-0.md, note-1.md, … */
  function makeManyFiles(n: number): { path: string; sha: string; content: string }[] {
    return Array.from({ length: n }, (_, i) => ({
      path: `note-${i}.md`, sha: `sha-${i}`, content: `# Note ${i}`,
    }))
  }

  it('readAll batches many files into a single aliased GraphQL request', async () => {
    const specs = makeManyFiles(10)
    fetchSpy
      .mockResolvedValueOnce(makeJsonResp(makeTreeResponse(specs)))
      .mockResolvedValueOnce(makeGraphQLResp(
        Object.fromEntries(specs.map((s, i) => [`f${i}`, { text: s.content }])),
      ))

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const files   = await backend.readAll()

    expect(files).toHaveLength(10)
    for (const s of specs) {
      const f = files.find(f => f.path === s.path)
      expect(f?.content).toBe(s.content)
      expect(f?.version).toBe(s.sha)
    }

    // Exactly 2 requests total: the tree listing and one GraphQL batch —
    // no per-file Contents requests.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [graphqlUrl, graphqlInit] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(graphqlUrl).toContain('/graphql')
    const sentBody = JSON.parse(graphqlInit.body as string) as { variables: { owner: string; name: string } }
    expect(sentBody.variables).toEqual({ owner: 'alice', name: 'notes' })
  })

  it('readAll falls back to the Contents API for blobs GraphQL returns null text for', async () => {
    const specs = makeManyFiles(8)
    const repository = Object.fromEntries(
      specs.map((s, i) => [`f${i}`, { text: i === 3 ? null : s.content }]),
    )

    fetchSpy
      .mockResolvedValueOnce(makeJsonResp(makeTreeResponse(specs)))
      .mockResolvedValueOnce(makeGraphQLResp(repository))
      // Fallback Contents-API fetch for the one null-text path (note-3.md).
      .mockResolvedValueOnce(makeJsonResp(makeFileResponse('note-3.md', specs[3].content, 'sha-3')))

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const files   = await backend.readAll()

    expect(files).toHaveLength(8)
    const fallback = files.find(f => f.path === 'note-3.md')
    expect(fallback?.content).toBe(specs[3].content)
    expect(fallback?.version).toBe('sha-3')

    // 1 tree + 1 GraphQL batch + 1 Contents fallback = 3 requests.
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('readAll chunks large path lists into multiple GraphQL requests', async () => {
    const specs = makeManyFiles(150) // > GRAPHQL_BATCH_SIZE (100) → 2 batches: 100 + 50
    const batch1 = specs.slice(0, 100)
    const batch2 = specs.slice(100)

    fetchSpy
      .mockResolvedValueOnce(makeJsonResp(makeTreeResponse(specs)))
      .mockResolvedValueOnce(makeGraphQLResp(
        Object.fromEntries(batch1.map((s, i) => [`f${i}`, { text: s.content }])),
      ))
      .mockResolvedValueOnce(makeGraphQLResp(
        // Aliases restart at f0 within each batch.
        Object.fromEntries(batch2.map((s, i) => [`f${i}`, { text: s.content }])),
      ))

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const files   = await backend.readAll()

    expect(files).toHaveLength(150)
    // Spot-check the boundary between the two batches.
    expect(files.find(f => f.path === 'note-99.md')?.content).toBe('# Note 99')
    expect(files.find(f => f.path === 'note-100.md')?.content).toBe('# Note 100')

    // 1 tree + 2 GraphQL batches = 3 requests.
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})
