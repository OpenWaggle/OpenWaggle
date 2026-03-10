import { randomBytes } from 'node:crypto'
import {
  HTTP_BAD_REQUEST,
  HTTP_UNAUTHORIZED,
  MILLISECONDS_PER_SECOND,
} from '@shared/constants/constants'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { shell } from 'electron'
import { createLogger } from '../../logger'
import { createCallbackServer } from '../oauth-callback-server'
import { generateCodeChallenge, generateCodeVerifier } from '../pkce'

const SPLIT_ARG_2 = 2
const RANDOM_BYTES_ARG_1 = 16

const logger = createLogger('openai-oauth')

// OpenAI requires a fixed port for the redirect URI
const OPENAI_CALLBACK_PORT = 1455
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OPENAI_REDIRECT_URI = `http://localhost:${OPENAI_CALLBACK_PORT}/auth/callback`

const tokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
})

interface OpenAIOAuthResult {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

export class OAuthRefreshError extends Error {
  readonly provider: 'openai'
  readonly status: number
  readonly body: string
  readonly fatal: boolean

  constructor(status: number, body: string) {
    super('OpenAI token refresh failed. Please sign in again.')
    this.name = 'OAuthRefreshError'
    this.provider = 'openai'
    this.status = status
    this.body = body
    this.fatal = status === HTTP_BAD_REQUEST || status === HTTP_UNAUTHORIZED
  }
}

interface OpenAIOAuthCode {
  readonly code: string
  readonly state?: string
  readonly source: 'callback' | 'manual'
}

interface StartOpenAIOAuthOptions {
  readonly manualCodePromise?: Promise<string>
  readonly onAwaitingCode?: () => void
  readonly onCodeReceived?: () => void
}

function parseManualCodeInput(raw: string): OpenAIOAuthCode {
  const input = raw.trim()
  if (!input) {
    throw new Error('Authorization code input is empty.')
  }

  // Full callback URL is preferred, but we also accept "code#state".
  try {
    const parsedUrl = new URL(input)
    const code = parsedUrl.searchParams.get('code')?.trim() ?? ''
    const state = parsedUrl.searchParams.get('state')?.trim() ?? ''
    if (code) {
      return { code, state, source: 'manual' }
    }
  } catch {
    // continue with non-URL parsing
  }

  const [code, state = ''] = input.split('#', SPLIT_ARG_2)
  const normalizedCode = code.trim()
  const normalizedState = state.trim()
  if (!normalizedCode) {
    throw new Error('Unable to parse OpenAI authorization code from input.')
  }
  return { code: normalizedCode, state: normalizedState, source: 'manual' }
}

export async function startOpenAIOAuth(
  options: StartOpenAIOAuthOptions = {},
): Promise<OpenAIOAuthResult> {
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = randomBytes(RANDOM_BYTES_ARG_1).toString('hex')
  let server: Awaited<ReturnType<typeof createCallbackServer>> | null = null

  try {
    try {
      server = await createCallbackServer({ port: OPENAI_CALLBACK_PORT })
    } catch (error) {
      logger.warn('OpenAI callback server unavailable, waiting for manual code input', {
        port: OPENAI_CALLBACK_PORT,
        error: error instanceof Error ? error.message : String(error),
      })
    }

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

    const candidates: Promise<OpenAIOAuthCode>[] = []
    if (server) {
      candidates.push(
        server
          .waitForCallback()
          .then((callback) => ({ code: callback.code, state: callback.state, source: 'callback' })),
      )
    }
    if (options.manualCodePromise) {
      options.onAwaitingCode?.()
      candidates.push(
        options.manualCodePromise.then((rawCode) => {
          options.onCodeReceived?.()
          return parseManualCodeInput(rawCode)
        }),
      )
    }
    if (candidates.length === 0) {
      throw new Error('Unable to receive OpenAI authorization code. Please try again.')
    }

    const callback = await Promise.race(candidates)
    if (callback.source === 'callback' && callback.state !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack')
    }
    if (callback.source === 'manual' && callback.state && callback.state !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack')
    }
    if (callback.source === 'manual' && !callback.state) {
      logger.warn('Manual OpenAI auth code submitted without state verification')
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
    const parsed = decodeUnknownOrThrow(tokenResponseSchema, raw)

    logger.info('OpenAI OAuth completed successfully')
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresAt: Date.now() + parsed.expires_in * MILLISECONDS_PER_SECOND,
    }
  } finally {
    server?.close()
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
    throw new OAuthRefreshError(response.status, text)
  }

  const raw: unknown = await response.json()
  const parsed = decodeUnknownOrThrow(tokenResponseSchema, raw)

  return {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * MILLISECONDS_PER_SECOND,
  }
}
