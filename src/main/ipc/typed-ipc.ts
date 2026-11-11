import { getParseIssues } from '@shared/schema'
import { HOST_BACKED_GUI_CHANNELS, type HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
} from '@shared/types/ipc'
import * as Cause from 'effect/Cause'
import type { Effect as EffectType } from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import { invokeConfiguredHostUiRaw } from '../application/gui-session-command-router'
import { DatabaseBootstrapError, DatabaseQueryError, type ValidationIssuesError } from '../errors'
import { ipcMainTransport } from '../desktop-shell/ipc-transport'
import { isGuiBackendGateHeld, waitForGuiBackend } from '../gui-backend-gate'
import { type GuiServices, runGuiEffect, runGuiEffectExit } from '../gui-runtime'
import { createLogger } from '../logger'
import type { IpcInvocation } from '../ports/desktop-shell/ipc-transport'
import { GatedSenderGoneError, rememberGatedSender } from './gated-ipc-sender'

const logger = createLogger('ipc')

/** Map `undefined` IPC return contracts to `void` so implicit handler returns remain valid. */
type ImplicitVoid = ReturnType<() => void>
type MaybeVoid<T> = T extends undefined ? ImplicitVoid : T

/**
 * Generic IPC handler type — accepts the event + channel-specific args.
 * Used internally by typedHandle/safeHandle to bridge the desktop shell's IPC transport to our
 * typed channel maps.
 */
type IpcHandler<C extends IpcInvokeChannel> = (
  event: IpcInvocation,
  ...args: IpcInvokeArgs<C>
) => unknown

type EffectIpcHandler<C extends IpcInvokeChannel> = (
  event: IpcInvocation,
  ...args: IpcInvokeArgs<C>
) => EffectType<MaybeVoid<IpcInvokeReturn<C>>, unknown, GuiServices>

function hasTag(error: unknown, tag: string): error is object & { readonly _tag: unknown } {
  return typeof error === 'object' && error !== null && '_tag' in error && error._tag === tag
}

function isValidationIssuesError(error: unknown): error is ValidationIssuesError {
  return (
    hasTag(error, 'ValidationIssuesError') &&
    'issues' in error &&
    Array.isArray(error.issues) &&
    error.issues.every((issue) => typeof issue === 'string')
  )
}

function isDatabaseBootstrapTaggedError(error: unknown): error is DatabaseBootstrapError {
  return (
    hasTag(error, 'DatabaseBootstrapError') &&
    'stage' in error &&
    typeof error.stage === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

function isDatabaseQueryTaggedError(error: unknown): error is DatabaseQueryError {
  return (
    hasTag(error, 'DatabaseQueryError') &&
    'operation' in error &&
    typeof error.operation === 'string'
  )
}

function toReadableIssues(issues: readonly string[]) {
  return issues.join('; ')
}

export function toIpcError(channel: IpcInvokeChannel, error: unknown) {
  if (isValidationIssuesError(error)) {
    const readable = toReadableIssues(error.issues)
    logger.warn(`Validation failed on "${channel}"`, { issues: readable })
    return new Error(`Invalid arguments for "${channel}": ${readable}`)
  }

  const parseIssues = getParseIssues(error)
  if (parseIssues) {
    const readable = parseIssues.join('; ')
    logger.warn(`Validation failed on "${channel}"`, { issues: readable })
    return new Error(`Invalid arguments for "${channel}": ${readable}`)
  }

  if (error instanceof DatabaseBootstrapError) {
    logger.error(`Database bootstrap failed on "${channel}"`, {
      stage: error.stage,
      message: error.message,
    })
    return new Error('OpenWaggle failed to initialize its application database.')
  }

  if (isDatabaseBootstrapTaggedError(error)) {
    const databaseError = error
    logger.error(`Database bootstrap failed on "${channel}"`, {
      stage: databaseError.stage,
      message: databaseError.message,
    })
    return new Error('OpenWaggle failed to initialize its application database.')
  }

  if (error instanceof DatabaseQueryError) {
    logger.error(`Database query failed on "${channel}"`, {
      operation: error.operation,
    })
    return new Error(`Failed to complete "${channel}" because a database query failed.`)
  }

  if (isDatabaseQueryTaggedError(error)) {
    const databaseError = error
    logger.error(`Database query failed on "${channel}"`, {
      operation: databaseError.operation,
    })
    return new Error(`Failed to complete "${channel}" because a database query failed.`)
  }

  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Channels the window answers before its backend is ready: its startup state, Retry, and the
 * logs the Host error screen opens. Every other request waits at the backend gate (A-F2).
 */
export const GUI_BACKEND_GATE_EXEMPT_CHANNELS: ReadonlySet<IpcInvokeChannel> = new Set([
  'app:get-startup-status',
  'app:retry-startup',
  'app:open-logs-dir',
  'app:get-logs-path',
])

/** Messages the window handles itself, with nothing of the backend: they never wait for it. */
const GUI_BACKEND_GATE_EXEMPT_SEND_CHANNELS: ReadonlySet<IpcSendChannel> = new Set([
  'clipboard:write-text',
  'error-reporting:renderer-envelope',
])

/**
 * Type-safe wrapper around the IPC transport's `handle`.
 * Internal — all public handlers should use the Effect-based `typedHandle`.
 */
function rawHandle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>) {
  const gated = !GUI_BACKEND_GATE_EXEMPT_CHANNELS.has(channel)
  ipcMainTransport.handle(channel, async (event, ...args) => {
    if (gated && isGuiBackendGateHeld()) {
      const senderStillThere = rememberGatedSender(event)
      await waitForGuiBackend()
      if (!senderStillThere()) throw new GatedSenderGoneError(channel)
    }
    return handler(event, ...args)
  })
}

export function typedHandle<C extends IpcInvokeChannel>(channel: C, handler: EffectIpcHandler<C>) {
  relayingHandle(channel, handler)
}

/**
 * A result the Session Host already produced through a channel's typed operation, which the
 * window relays to the renderer unchanged, as `hostHandle` does for a whole channel.
 */
export class RelayedHostResult {
  readonly value: unknown

  constructor(value: unknown) {
    this.value = value
  }
}

/** `typedHandle` for window-side orchestration that may relay part of its work to the Host. */
export function relayingHandle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (
    event: IpcInvocation,
    ...args: IpcInvokeArgs<C>
  ) => EffectType<MaybeVoid<IpcInvokeReturn<C>> | RelayedHostResult, unknown, GuiServices>,
) {
  rawHandle(channel, async (event, ...args) => {
    const exit = await runGuiEffectExit(handler(event, ...args))

    if (Exit.isSuccess(exit)) {
      return exit.value instanceof RelayedHostResult ? exit.value.value : exit.value
    }

    const failure = Cause.failureOption(exit.cause)
    if (Option.isSome(failure)) {
      throw toIpcError(channel, failure.value)
    }

    const defect = Cause.dieOption(exit.cause)
    if (Option.isSome(defect)) {
      throw toIpcError(channel, defect.value)
    }

    throw new Error('An unexpected Effect failure occurred.')
  })
}

/** A Host-backed channel before the GUI attached, or after it detached for quit. */
export class GuiSessionHostNotAttachedError extends Error {
  constructor(channel: string) {
    super(`"${channel}" needs the Session Host, and this window is not attached to it.`)
    this.name = 'GuiSessionHostNotAttachedError'
  }
}

/**
 * Relays a Host-backed channel to the Session Host (ADR 0030). The window answers none of them
 * itself: it never builds the Host's services (A-F5), and its requests wait at the backend gate
 * until it is attached.
 */
export function hostHandle<C extends HostBackedGuiChannel>(
  channel: C,
  options: {
    readonly prepareRemoteArgs?: (
      event: IpcInvocation,
      ...args: IpcInvokeArgs<C>
    ) => readonly unknown[] | Promise<readonly unknown[]>
    /** Runs after the Session Host handled the call; a failure is logged, never returned. */
    readonly afterRemote?: (
      result: unknown,
      ...args: IpcInvokeArgs<C>
    ) => EffectType<void, unknown, GuiServices>
  } = {},
) {
  if (!HOST_BACKED_GUI_CHANNELS.some((candidate) => candidate === channel)) {
    throw new Error(`Host-backed IPC channel is not declared: ${channel}`)
  }
  rawHandle(channel, async (event, ...args) => {
    const remoteArgs = options.prepareRemoteArgs
      ? await options.prepareRemoteArgs(event, ...args)
      : args
    const remote = await invokeConfiguredHostUiRaw(channel, remoteArgs)
    if (!remote.handled) throw new GuiSessionHostNotAttachedError(channel)
    if (options.afterRemote) {
      await runGuiEffect(options.afterRemote(remote.result, ...args)).catch((error: unknown) => {
        logger.warn('Host-backed IPC follow-up failed', {
          channel,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
    return remote.result
  })
}

/**
 * Type-safe wrapper around the IPC transport's `on`.
 * Internal — all public listeners should use the Effect-based `typedOn`.
 */
function rawOn<C extends IpcSendChannel>(
  channel: C,
  listener: (event: IpcInvocation, ...args: IpcSendArgs<C>) => void,
) {
  const gated = !GUI_BACKEND_GATE_EXEMPT_SEND_CHANNELS.has(channel)
  ipcMainTransport.on(channel, (event, ...args) => {
    if (!gated || !isGuiBackendGateHeld()) {
      listener(event, ...args)
      return
    }
    const senderStillThere = rememberGatedSender(event)
    void waitForGuiBackend().then(() => {
      if (senderStillThere()) listener(event, ...args)
    })
  })
}

type EffectIpcOnHandler<C extends IpcSendChannel> = (
  event: IpcInvocation,
  ...args: IpcSendArgs<C>
) => EffectType<void, unknown, GuiServices>

export function typedOn<C extends IpcSendChannel>(channel: C, handler: EffectIpcOnHandler<C>) {
  rawOn(channel, (event, ...args) => {
    runGuiEffect(handler(event, ...args)).catch((err: unknown) => {
      logger.error(`Unhandled error in "${channel}" listener`, {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  })
}
