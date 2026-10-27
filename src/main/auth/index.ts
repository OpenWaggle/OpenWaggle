import { AUTH_TIMEOUT } from '@shared/constants/time'
import type {
  OAuthAccountInfo,
  OAuthFlowStatus,
  OAuthInputPrompt,
  OAuthProvider,
} from '@shared/types/auth'
import * as Effect from 'effect/Effect'
import { openExternal } from '../desktop-ui'
import { runGuiEffect } from '../gui-runtime'
import { createLogger } from '../logger'
import { ProviderOAuthService } from '../ports/provider-oauth-service'

const logger = createLogger('auth')

type StatusEmitter = (status: OAuthFlowStatus) => void

interface PendingOAuthInputHandler {
  readonly resolve: (input: string) => void
  readonly reject: (error: Error) => void
}

interface InFlightOAuthFlow {
  readonly promise: Promise<void>
  readonly controller: AbortController
}

const pendingInputHandlers = new Map<OAuthProvider, PendingOAuthInputHandler>()
const inFlightOAuthFlows = new Map<OAuthProvider, InFlightOAuthFlow>()
const canceledOAuthFlows = new Set<OAuthProvider>()
const lifecycleConnectivity = new Map<OAuthProvider, boolean>()
let authLifecycleTimer: ReturnType<typeof setInterval> | null = null
let authLifecycleTickInFlight = false

export function submitCode(provider: OAuthProvider, code: string): void {
  const handler = pendingInputHandlers.get(provider)
  if (handler) {
    pendingInputHandlers.delete(provider)
    handler.resolve(code)
  }
}

export async function startOAuth(
  provider: OAuthProvider,
  emitStatus: StatusEmitter,
): Promise<void> {
  if (inFlightOAuthFlows.has(provider)) {
    const message = 'A sign-in attempt is already in progress for this provider.'
    emitStatus({ type: 'error', provider, message })
    throw new Error(message)
  }

  const controller = new AbortController()
  const flowPromise = runOAuthFlow(provider, emitStatus, controller.signal).finally(() => {
    inFlightOAuthFlows.delete(provider)
    canceledOAuthFlows.delete(provider)
  })
  inFlightOAuthFlows.set(provider, { promise: flowPromise, controller })
  await flowPromise
}

export async function cancelOAuth(
  provider: OAuthProvider,
  emitStatus: StatusEmitter,
): Promise<void> {
  const flow = inFlightOAuthFlows.get(provider)
  if (!flow) {
    emitStatus({ type: 'idle' })
    return
  }

  canceledOAuthFlows.add(provider)
  flow.controller.abort()

  const pending = pendingInputHandlers.get(provider)
  if (pending) {
    pendingInputHandlers.delete(provider)
    pending.reject(new Error('Login cancelled'))
  }

  await logoutOAuthProvider(provider)
  lifecycleConnectivity.set(provider, false)
  emitStatus({ type: 'idle' })
  logger.info('OAuth flow cancelled', { provider })
}

export function startAuthLifecycle(emitStatus: StatusEmitter): () => void {
  if (authLifecycleTimer) {
    clearInterval(authLifecycleTimer)
  }

  void runAuthLifecycleTick(emitStatus)
  authLifecycleTimer = setInterval(() => {
    void runAuthLifecycleTick(emitStatus)
  }, AUTH_TIMEOUT.LIFECYCLE_INTERVAL_MS)
  authLifecycleTimer.unref?.()

  return () => {
    if (authLifecycleTimer) {
      clearInterval(authLifecycleTimer)
      authLifecycleTimer = null
    }
    lifecycleConnectivity.clear()
  }
}

async function runOAuthFlow(
  provider: OAuthProvider,
  emitStatus: StatusEmitter,
  signal: AbortSignal,
) {
  emitStatus({ type: 'in-progress', provider })
  // The latest sign-in link and its instructions, shown with every later prompt so a user whose
  // browser runs elsewhere (copy-code sign-in) can open it there.
  let link: { readonly authUrl: string; readonly instructions?: string } | null = null
  const awaitingInput = (prompt?: OAuthInputPrompt): OAuthFlowStatus => ({
    type: 'awaiting-code',
    provider,
    ...(link ?? {}),
    ...(prompt ? { prompt } : {}),
  })

  try {
    await runGuiEffect(
      Effect.gen(function* () {
        const authService = yield* ProviderOAuthService
        yield* authService.login(provider, {
          onAuthUrl: (url, instructions) => {
            link = { authUrl: url, ...(instructions ? { instructions } : {}) }
            void openExternal(url).catch((error) => {
              logger.warn('Failed to open OAuth URL', {
                provider,
                error: error instanceof Error ? error.message : String(error),
              })
            })
            // A sign-in that finishes in the browser asks nothing more, so its instructions and
            // link are all there is to show while it waits.
            emitStatus(awaitingInput())
          },
          onDeviceCode: (deviceCode) => {
            void openExternal(deviceCode.verificationUri).catch((error) => {
              logger.warn('Failed to open OAuth device-code URL', {
                provider,
                error: error instanceof Error ? error.message : String(error),
              })
            })
            emitStatus({ type: 'awaiting-code', provider, deviceCode })
          },
          onSelect: async (selection) => {
            if (selection.options.length === 0) return undefined
            emitStatus({ type: 'awaiting-selection', provider, selection })
            return createOAuthInputPromise(provider)
          },
          onPrompt: async (prompt, promptSignal) => {
            emitStatus(awaitingInput(prompt))
            return createOAuthInputPromise(provider, { signal: promptSignal, emitStatus })
          },
          onProgress: () => {
            emitStatus({ type: 'in-progress', provider })
          },
          onManualCodeInput: (prompt, promptSignal) => {
            emitStatus(awaitingInput(prompt))
            return createOAuthInputPromise(provider, { signal: promptSignal, emitStatus })
          },
          signal,
        })
      }),
    )

    if (signal.aborted || canceledOAuthFlows.has(provider)) {
      await logoutOAuthProvider(provider)
      emitStatus({ type: 'idle' })
      return
    }

    lifecycleConnectivity.set(provider, true)
    emitStatus({ type: 'success', provider })
    logger.info('OAuth flow completed', { provider })
  } catch (err) {
    if (signal.aborted || canceledOAuthFlows.has(provider)) {
      emitStatus({ type: 'idle' })
      return
    }

    const message = err instanceof Error ? err.message : 'Unknown OAuth error'
    logger.warn('OAuth flow failed', { provider, error: message })
    emitStatus({ type: 'error', provider, message })
    throw err
  } finally {
    const pending = pendingInputHandlers.get(provider)
    if (pending) {
      pendingInputHandlers.delete(provider)
      pending.reject(new Error('Sign-in flow closed before an authorization code was submitted.'))
    }
  }
}

/**
 * The answer the user types or pastes. `signal` aborts when the sign-in no longer needs it, such
 * as when the browser callback finished it first: the field goes away and the sign-in shows as in
 * progress again.
 */
function createOAuthInputPromise(
  provider: OAuthProvider,
  cancellation?: { readonly signal: AbortSignal | undefined; readonly emitStatus: StatusEmitter },
) {
  const existingPending = pendingInputHandlers.get(provider)
  if (existingPending) {
    pendingInputHandlers.delete(provider)
    existingPending.reject(
      new Error('A new sign-in attempt was started before the previous one completed.'),
    )
  }

  const inputPromise = new Promise<string>((resolve, reject) => {
    const pending = { resolve, reject }
    pendingInputHandlers.set(provider, pending)
    cancellation?.signal?.addEventListener(
      'abort',
      () => {
        if (pendingInputHandlers.get(provider) !== pending) return
        pendingInputHandlers.delete(provider)
        reject(new Error('The sign-in no longer needs this answer.'))
        cancellation.emitStatus({ type: 'in-progress', provider })
      },
      { once: true },
    )
  })
  void inputPromise.catch(() => {})
  return inputPromise
}

async function runAuthLifecycleTick(emitStatus: StatusEmitter) {
  if (authLifecycleTickInFlight) return
  authLifecycleTickInFlight = true

  try {
    const providerStates = await runGuiEffect(
      Effect.gen(function* () {
        const authService = yield* ProviderOAuthService
        const providers = yield* authService.listProviders()
        const states: { readonly provider: OAuthProvider; readonly connected: boolean }[] = []

        for (const provider of providers) {
          const connected = yield* authService.isConnected(provider)
          states.push({ provider, connected })
        }

        return states
      }),
    )

    for (const { provider, connected } of providerStates) {
      const previous = lifecycleConnectivity.get(provider)

      if (!connected && previous === true) {
        emitStatus({ type: 'error', provider, message: 'Session expired. Please sign in again.' })
      }
      if (connected && previous === false) {
        emitStatus({ type: 'success', provider })
      }

      lifecycleConnectivity.set(provider, connected)
    }
  } catch (error) {
    logger.warn('auth lifecycle refresh tick failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    authLifecycleTickInFlight = false
  }
}

async function logoutOAuthProvider(provider: OAuthProvider) {
  await runGuiEffect(
    Effect.gen(function* () {
      const authService = yield* ProviderOAuthService
      yield* authService.logout(provider)
    }),
  )
}

export async function disconnect(provider: OAuthProvider): Promise<void> {
  await logoutOAuthProvider(provider)

  logger.info('Disconnected OAuth provider', { provider })
}

export async function getAccountInfo(provider: OAuthProvider): Promise<OAuthAccountInfo> {
  return runGuiEffect(
    Effect.gen(function* () {
      const authService = yield* ProviderOAuthService
      return yield* authService.getAccountInfo(provider)
    }),
  )
}
