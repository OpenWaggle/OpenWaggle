import { randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { z } from 'zod'
import { createLogger } from '../../logger'
import { createCallbackServer } from '../oauth-callback-server'
import { generateCodeChallenge, generateCodeVerifier } from '../pkce'

const RANDOM_BYTES_ARG_1 = 16

const logger = createLogger('openrouter-oauth')

const keyResponseSchema = z.object({
  key: z.string(),
})

interface OpenRouterOAuthResult {
  readonly apiKey: string
}

export async function startOpenRouterOAuth(): Promise<OpenRouterOAuthResult> {
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = randomBytes(RANDOM_BYTES_ARG_1).toString('hex')

  const server = await createCallbackServer()

  try {
    const authUrl = new URL('https://openrouter.ai/auth')
    authUrl.searchParams.set('callback_url', `http://localhost:${server.port}`)
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)

    logger.info('Opening OpenRouter auth page', { port: server.port })
    await shell.openExternal(authUrl.toString())

    const callback = await server.waitForCallback()

    if (callback.state !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack')
    }

    logger.info('Received auth code, exchanging for API key')

    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: callback.code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      logger.warn('OpenRouter token exchange failed', { status: response.status, body: text })
      throw new Error('OpenRouter authentication failed. Please try again.')
    }

    const raw: unknown = await response.json()
    const parsed = keyResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error('Unexpected response from OpenRouter token exchange')
    }

    logger.info('OpenRouter OAuth completed successfully')
    return { apiKey: parsed.data.key }
  } finally {
    server.close()
  }
}
