import { randomUUID } from 'node:crypto'
import {
  decodeFollowUpEditHoldReference,
  decodeSessionControlMutationRequest,
} from '@shared/schemas/session-control'
import { decodeSessionQueryRequest } from '@shared/schemas/session-query'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationRequest,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { powerMonitor, webContents } from 'electron'
import { dispatchLocalSessionCommand } from '../application/local-session-command-dispatcher'
import { createLogger } from '../logger'
import { runAppEffect } from '../runtime'
import {
  FollowUpEditHoldWindowLeases,
  type WindowFollowUpEditHold,
  WindowPageGenerations,
} from './follow-up-edit-hold-window-leases'
import { typedHandle } from './typed-ipc'

const logger = createLogger('session-control-ipc')

/** Rejections that mean the hold no longer exists, so the window stops renewing it. */
const HOLD_GONE_CODES: ReadonlySet<string> = new Set([
  'follow_up_not_found',
  'follow_up_not_editable',
  'follow_up_edit_not_held',
  'follow_up_edit_hold_mismatch',
])

const windowGenerations = new WindowPageGenerations((windowId, events) => {
  const contents = webContents.fromId(windowId)
  if (!contents || contents.isDestroyed()) return false
  contents.on('did-navigate', events.pageChanged)
  contents.on('render-process-gone', events.pageChanged)
  contents.once('destroyed', events.destroyed)
  return true
})

function dispatchGuiCommand(payload: LocalSessionCommandPayload) {
  return dispatchLocalSessionCommand({
    caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
    payload,
  })
}

function renewHold(hold: WindowFollowUpEditHold) {
  return runAppEffect(
    dispatchGuiCommand({
      contract: 'local-ui-v1',
      request: {
        requestId: randomUUID(),
        command: { operation: 'renew-follow-up-edit-hold', ...hold },
      },
    }),
  ).then(
    (result) =>
      result.contract === 'local-ui-v1' && result.response.effect === 'follow-up-edit-hold-renewed',
  )
}

function releaseHold(hold: WindowFollowUpEditHold) {
  const key = `follow-up-edit-window-closed:${hold.holdId}`
  return runAppEffect(
    dispatchGuiCommand({
      contract: 'session-control-v2',
      request: {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: key,
        idempotencyKey: key,
        command: { operation: 'queue-edit-cancel', ...hold },
      },
    }),
  ).then(() => undefined)
}

/** A window is gone for its holds when it closes, crashes, reloads, or navigates to a new page. */
function watchWindow(windowId: number, onGone: () => void) {
  const contents = webContents.fromId(windowId)
  if (!contents || contents.isDestroyed()) {
    onGone()
    return
  }
  let gone = false
  const release = () => {
    if (gone) return
    gone = true
    contents.off('did-navigate', release)
    contents.off('render-process-gone', release)
    contents.off('destroyed', release)
    onGone()
  }
  contents.on('did-navigate', release)
  contents.on('render-process-gone', release)
  contents.on('destroyed', release)
}

const windowLeases = new FollowUpEditHoldWindowLeases({
  renew: renewHold,
  release: releaseHold,
  watchWindow,
  onError: (message, error) => logger.warn(message, { error: String(error) }),
})

/** Binds the Follow-up edit holds a window begins to that window (ADR 0044). */
function trackFollowUpEditHold(
  window: { readonly windowId: number; readonly generation: number | undefined },
  request: SessionControlMutationRequest,
  response: SessionControlMutationResponse,
) {
  const { command } = request
  const { outcome } = response
  if (command.operation === 'queue-edit-begin' && outcome.effect === 'follow-up-edit-held') {
    const hold = {
      sessionId: outcome.sessionId,
      followUpId: outcome.followUpId,
      holdId: outcome.holdId,
    }
    if (windowGenerations.isCurrent(window.windowId, window.generation)) {
      windowLeases.track(window.windowId, hold)
    } else {
      void releaseHold(hold).catch((error: unknown) =>
        logger.warn('A Follow-up edit begun by a closed window could not be released', {
          error: String(error),
        }),
      )
    }
    return
  }
  if (command.operation !== 'queue-edit-save' && command.operation !== 'queue-edit-cancel') return
  if (outcome.effect !== 'rejected' || HOLD_GONE_CODES.has(outcome.code)) {
    windowLeases.forget(command.holdId)
  }
}

export function registerSessionControlHandlers() {
  // Timers may fire late after a sleep; renew at once so an open edit keeps its hold.
  powerMonitor.on('resume', () => {
    void windowLeases.renewAll()
  })
  typedHandle('session-control:mutate', (event, rawRequest) =>
    Effect.gen(function* () {
      const request = decodeSessionControlMutationRequest(rawRequest)
      const window = {
        windowId: event.sender.id,
        generation:
          request.command.operation === 'queue-edit-begin'
            ? windowGenerations.snapshot(event.sender.id)
            : undefined,
      }
      const result = yield* dispatchGuiCommand({ contract: 'session-control-v2', request })
      if (result.contract !== 'session-control-v2') {
        return yield* Effect.die(new Error('Session Control returned the wrong contract.'))
      }
      trackFollowUpEditHold(window, request, result.response)
      return result.response
    }),
  )

  typedHandle('session-control:adopt-follow-up-edit', (event, rawHold) =>
    Effect.promise(() => {
      const hold = decodeFollowUpEditHoldReference(rawHold)
      const windowId = event.sender.id
      const generation = windowGenerations.snapshot(windowId)
      return windowLeases
        .adopt(windowId, hold, () => windowGenerations.isCurrent(windowId, generation))
        .catch((error: unknown) => {
          // Not adopted: the window that holds it keeps renewing it, or its lease expires.
          logger.warn('A Follow-up edit hold could not be adopted', { error: String(error) })
          return false
        })
    }),
  )

  typedHandle('session-control:query', (_event, rawRequest) =>
    Effect.gen(function* () {
      const request = decodeSessionQueryRequest(rawRequest)
      const result = yield* dispatchGuiCommand({ contract: 'session-query-v2', request })
      if (result.contract !== 'session-query-v2') {
        return yield* Effect.die(new Error('Session query returned the wrong contract.'))
      }
      return result.response
    }),
  )
}
