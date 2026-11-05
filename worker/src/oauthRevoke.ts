import type { Env } from './env'

// Injectable for the same reason as `GitHubTokenExchanger`: tests stub GitHub
// without network mocking. Receives the client credentials and the token.
export type GitHubTokenRevoker = (clientId: string, clientSecret: string, accessToken: string) => Promise<Response>

// GitHub's "Delete an app token" endpoint: authenticates as the app (basic
// auth), and answers 204 on success or 404 when the token is already invalid.
const revokeWithGitHub: GitHubTokenRevoker = (clientId, clientSecret, accessToken) =>
  fetch(`https://api.github.com/applications/${clientId}/token`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'meridian-oauth-worker',
    },
    body: JSON.stringify({ access_token: accessToken }),
  })

export async function handleOAuthRevoke(
  request: Request,
  env: Env,
  revoke: GitHubTokenRevoker = revokeWithGitHub,
): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'invalid_request', error_description: 'Request body must be form-encoded' }, { status: 400 })
  }
  const accessToken = form.get('access_token')
  if (typeof accessToken !== 'string' || !accessToken) {
    return Response.json({ error: 'invalid_request', error_description: 'Missing access_token' }, { status: 400 })
  }

  let githubResponse: Response
  try {
    githubResponse = await revoke(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, accessToken)
  } catch {
    return Response.json({ error: 'server_error', error_description: 'Could not reach GitHub' }, { status: 502 })
  }
  // 204 revoked; 404 already invalid — both mean the token is dead.
  if (githubResponse.status === 204 || githubResponse.status === 404) return new Response(null, { status: 204 })
  return Response.json({ error: 'server_error', error_description: 'GitHub refused the revoke' }, { status: 502 })
}
