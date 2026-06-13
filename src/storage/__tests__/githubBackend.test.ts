import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { encodeBase64, decodeBase64, mapGitHubError } from '../githubApi'
import { GitHubBackend } from '../githubBackend'
import { ConflictError } from '../conflictError'

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

function makeRootDirResponse(files: { name: string; sha: string }[]) {
  return files.map(f => ({ type: 'file', name: f.name, sha: f.sha, path: f.name }))
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

  function mockFetch(body: unknown, status = 200) {
    // Octokit iterates over response.headers, so we must provide a real Headers object.
    const headers = new Headers({
      'content-type': 'application/json',
      'x-ratelimit-remaining': '4999',
    })
    fetchSpy.mockResolvedValue({
      ok:     status >= 200 && status < 300,
      status,
      headers,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }

  it('statAll calls root contents endpoint and filters vault files', async () => {
    const files = [
      { name: 'note.md',   sha: 'sha1' },
      { name: 'image.png', sha: 'sha2' }, // non-vault file — should be filtered
      { name: 'data.yaml', sha: 'sha3' },
    ]
    mockFetch(makeRootDirResponse(files))

    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    const tokens  = await backend.statAll()

    expect(tokens.size).toBe(2)
    expect(tokens.get('note.md')).toBe('sha1')
    expect(tokens.get('data.yaml')).toBe('sha3')
    expect(tokens.has('image.png')).toBe(false)

    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toContain('/repos/alice/notes/contents')
    expect(url).toContain('ref=main')
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
    mockFetch(makeRootDirResponse([{ name: 'note.md', sha: 'existingsha' }]))
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
    mockFetch(makeRootDirResponse([{ name: 'old.md', sha: 'delsha' }]))
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

  it('ensurePermission returns granted on successful repo fetch', async () => {
    mockFetch({ id: 123, name: 'notes' })
    const backend = new GitHubBackend('id1', 'alice/notes', BASE_CFG)
    expect(await backend.ensurePermission(false)).toBe('granted')
  })

  it('ensurePermission returns denied on 401', async () => {
    mockFetch({ message: 'Bad credentials' }, 401)
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

    // statAll response
    fetchSpy
      .mockResolvedValueOnce(makeResp(makeRootDirResponse([
        { name: 'a.md', sha: 'sha-a' },
        { name: 'b.md', sha: 'sha-b' },
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
