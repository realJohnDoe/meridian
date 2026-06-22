import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { encodeBase64, decodeBase64, mapGitHubError } from '@/storage/githubApi'
import { GitHubBackend } from '@/storage/githubBackend'
import { ConflictError } from '@/storage/conflictError'

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

  it('maps 401 to token message',      () => expect(mapGitHubError(makeErr(401)).message).toMatch(/invalid or expired/i))
  it('maps 403 to access/rate message',() => expect(mapGitHubError(makeErr(403)).message).toMatch(/access denied|rate limit/i))
  it('maps 404 to not-found message',  () => expect(mapGitHubError(makeErr(404)).message).toMatch(/not found|lacks access/i))
  it('maps 409 to ConflictError',       () => expect(mapGitHubError(makeErr(409))).toBeInstanceOf(ConflictError))
  it('maps 422 to ConflictError',       () => expect(mapGitHubError(makeErr(422))).toBeInstanceOf(ConflictError))
  it('passes through unknown errors',  () => {
    const e = new Error('network failure')
    expect(mapGitHubError(e)).toBe(e)
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

    const body = JSON.parse(init.body as string)
    expect(body.branch).toBe('main')
    expect(body.sha).toBeUndefined()
    expect(decodeBase64(body.content)).toBe('# New note')
  })

  it('write sends expectedVersion as sha (CAS write)', async () => {
    mockFetch({ content: { sha: 'updatedsha' } })
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.write('note.md', '# Updated', 'existingsha')

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.sha).toBe('existingsha')
    expect(decodeBase64(body.content)).toBe('# Updated')
  })

  it('write without expectedVersion omits sha (new file)', async () => {
    mockFetch({ content: { sha: 'newsha' } })
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.write('new.md', '# New')

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
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
    const body = JSON.parse(init.body as string)
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

    const body = JSON.parse(init.body as string)
    expect(body.sha).toBe('delsha')
    expect(body.branch).toBe('main')
  })

  it('delete is a no-op for files with unknown sha', async () => {
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    await backend.delete('nonexistent.md')
    expect(fetchSpy).not.toHaveBeenCalled()
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

  it('readAll returns all vault files with decoded content', async () => {
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
      // readFiles responses (two parallel fetches)
      .mockResolvedValueOnce(makeResp(makeFileResponse('a.md', '# A', 'sha-a')))
      .mockResolvedValueOnce(makeResp(makeFileResponse('b.md', '# B', 'sha-b')))

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const files   = await backend.readAll()

    expect(files).toHaveLength(2)
    expect(files.map(f => f.path).sort()).toEqual(['a.md', 'b.md'])
  })
})
