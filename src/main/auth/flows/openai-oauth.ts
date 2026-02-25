import { randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { z } from 'zod'
import { createLogger } from '../../logger'
import { createCallbackServer } from '../oauth-callback-server'
import { generateCodeChallenge, generateCodeVerifier } from '../pkce'

const logger = createLogger('openai-oauth')

// OpenAI requires a fixed port for the redirect URI
const OPENAI_CALLBACK_PORT = 1455
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OPENAI_REDIRECT_URI = `http://localhost:${OPENAI_CALLBACK_PORT}/auth/callback`

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
})

interface OpenAIOAuthResult {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

export async function startOpenAIOAuth(): Promise<OpenAIOAuthResult> {
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = randomBytes(16).toString('hex')

  const server = await createCallbackServer({ port: OPENAI_CALLBACK_PORT })

  try {
    const authUrl = new URL(OPENAI_AUTH_URL)
    authUrl.searchParams.set('client_id', OPENAI_CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', OPENAI_REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'openid profile email offline_access')
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('id_token_add_organizations', 'true')
    authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
    authUrl.searchParams.set('originator', 'openwaggle')

    logger.info('Opening OpenAI auth page')
    await shell.openExternal(authUrl.toString())

    const callback = await server.waitForCallback()

    if (callback.state !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack')
    }

    logger.info('Received auth code, exchanging for tokens')

    const response = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: OPENAI_CLIENT_ID,
        code: callback.code,
        redirect_uri: OPENAI_REDIRECT_URI,
        code_verifier: verifier,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      logger.warn('OpenAI token exchange failed', { status: response.status, body: text })
      throw new Error('OpenAI authentication failed. Please try again.')
    }

    const raw: unknown = await response.json()
    const parsed = tokenResponseSchema.parse(raw)

    logger.info('OpenAI OAuth completed successfully')
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresAt: Date.now() + parsed.expires_in * 1000,
    }
  } finally {
    server.close()
  }
}

export async function refreshOpenAIToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: OPENAI_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    logger.warn('OpenAI token refresh failed', { status: response.status, body: text })
    throw new Error('OpenAI token refresh failed. Please sign in again.')
  }

  const raw: unknown = await response.json()
  const parsed = tokenResponseSchema.parse(raw)

  return {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  }
}
