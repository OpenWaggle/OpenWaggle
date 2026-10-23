import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { SessionCompactEvent } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
} from './pi-native-compaction-integration.test-utils'
import { makeCompactResponse } from './pi-native-compaction-test-fixtures'

const OPENCODE_BASE_URL = 'https://opencode.ai/zen/v1'
const THRESHOLD_TOKENS = 80
const LATER_MS = 60_000

/** The `x-opencode-session` header of each Native compaction request. */
function stubCompactionFetch() {
  const sessionHeaders: (string | null)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      sessionHeaders.push(new Headers(init?.headers).get('x-opencode-session'))
      return makeCompactResponse([
        { type: 'compaction', id: `cmp_${sessionHeaders.length}`, encrypted_content: 'opaque' },
      ])
    }),
  )
  return sessionHeaders
}

/*
 * Pi 1.4.0's ModelRuntime sends opencode's `x-opencode-session` with every request to opencode.
 * The patched Native compaction request prepares its own headers, which must keep it.
 */
describe('Pi native compaction to opencode', () => {
  afterEach(cleanupNativeSessions)

  it.each([
    ['without', false],
    ['with', true],
  ])('keeps the opencode session header %s a provider header hook', async (_label, withHook) => {
    const directory = createNativeTempDirectory('openwaggle-native-opencode-session-')
    const events: SessionCompactEvent[] = []
    const sessionHeaders = stubCompactionFetch()
    const { session, sessionManager } = await createNativeSession({
      directory,
      compactionEvents: events,
      authBaseUrl: OPENCODE_BASE_URL,
      ...(withHook ? { providerAuthHeaderState: { authorization: 'Bearer hook-token' } } : {}),
    })

    await session.compact()

    expect(sessionHeaders).toEqual([sessionManager.getSessionId()])
  })
  it.each([
    ['without', false],
    ['with', true],
  ])(
    'keeps the opencode session header on automatic compaction %s a provider header hook',
    async (_label, withHook) => {
      const directory = createNativeTempDirectory('openwaggle-native-opencode-session-auto-')
      const sessionHeaders = stubCompactionFetch()
      const threshold = fauxAssistantMessage('Reached threshold')
      threshold.usage.totalTokens = THRESHOLD_TOKENS
      threshold.usage.input = THRESHOLD_TOKENS
      threshold.timestamp = Date.now() + LATER_MS
      const { session, sessionManager } = await createNativeSession({
        directory,
        compactionEvents: [],
        authBaseUrl: OPENCODE_BASE_URL,
        responses: [threshold, fauxAssistantMessage('Complete')],
        ...(withHook ? { providerAuthHeaderState: { authorization: 'Bearer hook-token' } } : {}),
      })

      await session.prompt('first turn')
      await session.prompt('second turn')

      expect(sessionHeaders).toEqual([sessionManager.getSessionId()])
    },
  )
})

// Pi keeps the fingerprint function internal; read it from Pi's own session manager module.
const PI_SESSION_MANAGER_MODULE = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js',
)

async function nativeCredentialFingerprint(headers: Record<string, string>) {
  const piModule: unknown = await import(pathToFileURL(PI_SESSION_MANAGER_MODULE).href)
  const fingerprint: unknown =
    typeof piModule === 'object' && piModule !== null
      ? Reflect.get(piModule, 'nativeCredentialFingerprint')
      : undefined
  if (typeof fingerprint !== 'function') throw new Error('Pi credential fingerprint moved')
  const value: unknown = Reflect.apply(fingerprint, undefined, [undefined, headers])
  return value
}

describe('Native credential fingerprint of header-only credentials', () => {
  it('ignores the opencode session header, so a checkpoint survives a fork', async () => {
    const credential = { 'x-api-token': 'secret' }

    const first = await nativeCredentialFingerprint({
      ...credential,
      'x-opencode-session': 'session-1',
    })
    const forked = await nativeCredentialFingerprint({
      ...credential,
      'x-opencode-session': 'session-2',
    })

    expect(first).toEqual(expect.any(String))
    expect(forked).toBe(first)
    expect(await nativeCredentialFingerprint({ 'x-api-token': 'other' })).not.toBe(first)
  })
})
