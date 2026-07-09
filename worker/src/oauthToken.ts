export interface Env {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
}

// Injectable so tests can stub GitHub's token endpoint without real network
// mocking — Request/Response/FormData/URLSearchParams are all standard Fetch
// API globals, so this handler needs no Workers-runtime-specific test tooling.
export type GitHubTokenExchanger = (params: URLSearchParams) => Promise<Response>

const exchangeWithGitHub: GitHubTokenExchanger = (params) =>
  fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // GitHub's token endpoint returns form-urlencoded by default; this
      // gets JSON instead.
      Accept: 'application/json',
    },
    body: params.toString(),
  })

function badRequest(description: string): Response {
  return Response.json({ error: 'invalid_request', error_description: description }, { status: 400 })
}

function badGateway(description: string): Response {
  return Response.json({ error: 'server_error', error_description: description }, { status: 502 })
}

export async function handleOAuthToken(
  request: Request,
  env: Env,
  exchange: GitHubTokenExchanger = exchangeWithGitHub,
): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return badRequest('Request body must be form-encoded')
  }
  const grantType = form.get('grant_type')

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
  })

  if (grantType === 'authorization_code') {
    const code = form.get('code')
    const codeVerifier = form.get('code_verifier')
    if (typeof code !== 'string' || typeof codeVerifier !== 'string') {
      return badRequest('Missing code or code_verifier')
    }
    params.set('grant_type', 'authorization_code')
    params.set('code', code)
    params.set('code_verifier', codeVerifier)
  } else if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token')
    if (typeof refreshToken !== 'string') {
      return badRequest('Missing refresh_token')
    }
    params.set('grant_type', 'refresh_token')
    params.set('refresh_token', refreshToken)
  } else {
    return badRequest('grant_type must be authorization_code or refresh_token')
  }

  const githubResponse = await exchange(params)
  let data: unknown
  try {
    data = await githubResponse.json()
  } catch {
    return badGateway('GitHub returned a non-JSON response')
  }
  return Response.json(data, { status: githubResponse.status })
}
