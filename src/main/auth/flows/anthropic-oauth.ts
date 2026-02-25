import { clipboard, shell } from 'electron'
import { z } from 'zod'
import { createLogger } from '../../logger'
import { generateCodeChallenge, generateCodeVerifier } from '../pkce'

const logger = createLogger('anthropic-oauth')

const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const ANTHROPIC_AUTH_URL = 'https://claude.ai/oauth/authorize'
const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const ANTHROPIC_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const ANTHROPIC_SCOPES = 'org:create_api_key user:profile user:inference'

const CLIPBOARD_POLL_INTERVAL_MS = 500
const CLIPBOARD_POLL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
})

interface AnthropicOAuthResult {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

/**
 * Poll the clipboard for a `code#state` string copied by the user.
 * Races against any externally-provided code promise (e.g. from the UI paste input).
 */
function pollClipboardForCode(signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const initialContent = clipboard.readText()
    let elapsed = 0
    let interval: ReturnType<typeof setInterval> | null = null

    const cleanup = (): void => {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    const onAbort = (): void => {
      cleanup()
      reject(new Error('OAuth flow was cancelled'))
    }

    if (signal?.aborted) {
      onAbort()
      return
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    interval = setInterval(() => {
      if (signal?.aborted) {
        onAbort()
        return
      }

      elapsed += CLIPBOARD_POLL_INTERVAL_MS
      if (elapsed >= CLIPBOARD_POLL_TIMEOUT_MS) {
        cleanup()
        reject(new Error('Timed out waiting for authorization code. Please try again.'))
        return
      }

      const content = clipboard.readText().trim()
      if (content && content !== initialContent && content.includes('#')) {
        cleanup()
        resolve(content)
      }
    }, CLIPBOARD_POLL_INTERVAL_MS)
  })
}

/**
 * Parse a `code#state` string into its components.
 */
function parseCodeInput(input: string): { code: string; state: string } {
  const hashIndex = input.indexOf('#')
  if (hashIndex === -1) {
    return { code: input, state: '' }
  }
  return {
    code: input.slice(0, hashIndex),
    state: input.slice(hashIndex + 1),
  }
}

export async function startAnthropicOAuth(
  manualCodePromise?: Promise<string>,
  onCodeReceived?: () => void,
): Promise<AnthropicOAuthResult> {
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)

  // Anthropic uses state = verifier (matching pi-ai implementation)
  const authUrl = new URL(ANTHROPIC_AUTH_URL)
  authUrl.searchParams.set('code', 'true')
  authUrl.searchParams.set('client_id', ANTHROPIC_CLIENT_ID)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', ANTHROPIC_REDIRECT_URI)
  authUrl.searchParams.set('scope', ANTHROPIC_SCOPES)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', verifier)

  logger.info('Opening Anthropic auth page')
  await shell.openExternal(authUrl.toString())

  logger.info('Waiting for authorization code (clipboard polling + manual input)')

  // Race clipboard polling against manual code submission from the UI
  const pollAbortController = new AbortController()
  const candidates: Promise<string>[] = [pollClipboardForCode(pollAbortController.signal)]
  if (manualCodePromise) {
    candidates.push(manualCodePromise)
  }
  const rawCode = await Promise.race(candidates).finally(() => {
    pollAbortController.abort()
  })
  onCodeReceived?.()
  const { code, state } = parseCodeInput(rawCode.trim())

  logger.info('Received auth code, exchanging for tokens')

  // Token exchange uses JSON body (not form-encoded)
  const response = await fetch(ANTHROPIC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: ANTHROPIC_CLIENT_ID,
      code,
      state,
      redirect_uri: ANTHROPIC_REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    logger.warn('Anthropic token exchange failed', { status: response.status, body: text })
    throw new Error('Anthropic authentication failed. Please try again.')
  }

  const raw: unknown = await response.json()
  const parsed = tokenResponseSchema.parse(raw)

  // 5-minute buffer on expiry (matching pi-ai)
  const expiresAt = Date.now() + parsed.expires_in * 1000 - 5 * 60 * 1000

  logger.info('Anthropic OAuth completed successfully')
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt,
  }
}

export async function refreshAnthropicToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  // Refresh also uses JSON body
  const response = await fetch(ANTHROPIC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: ANTHROPIC_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    logger.warn('Anthropic token refresh failed', { status: response.status, body: text })
    throw new Error('Anthropic token refresh failed. Please sign in again.')
  }

  const raw: unknown = await response.json()
  const parsed = tokenResponseSchema.parse(raw)

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: Date.now() + parsed.expires_in * 1000 - 5 * 60 * 1000,
  }
}
