import {
  DESKTOP_SERVICE_LIMITS,
  type DesktopFenceRecord,
  type DesktopMutationScope,
  type DesktopServiceCommand,
} from '@shared/types/desktop-service'
import * as Effect from 'effect/Effect'
import { desktopCommandTouchesFence } from '../application/desktop-service-policy'
import type { TerminalServiceShape } from '../ports/terminal-service'

interface HeldFence {
  readonly record: DesktopFenceRecord
  readonly acquired: Promise<void>
  readonly finished: Promise<void>
  readonly release: () => void
}

function sameFence(left: DesktopFenceRecord, right: DesktopFenceRecord) {
  return (
    left.token === right.token &&
    left.hostInstanceId === right.hostInstanceId &&
    JSON.stringify(left.scope) === JSON.stringify(right.scope)
  )
}

export function makeGuiDesktopMutationFences(input: {
  readonly terminal: TerminalServiceShape
  readonly acquireBrowserMutationFence: (scope: DesktopMutationScope) => Promise<() => void>
  readonly drainBrowser: (record: DesktopFenceRecord) => Promise<void>
}) {
  const held = new Map<string, HeldFence>()

  async function ensure(record: DesktopFenceRecord) {
    if (record.state !== 'active') throw new Error('Only an active desktop fence may be acquired.')
    const existing = held.get(record.token)
    if (existing) {
      if (!sameFence(existing.record, record)) throw new Error('Desktop fence identity changed.')
      return existing.acquired
    }
    if (held.size >= DESKTOP_SERVICE_LIMITS.fenceRecords)
      throw new Error('Desktop fence capacity exceeded.')
    const acquired = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let acquiredNativeFence = false
    let browserReleaseFailed = false
    const finished = (async () => {
      const releaseBrowser = await input.acquireBrowserMutationFence(record.scope)
      const terminalOutcome = await (async () => {
        await input.drainBrowser(record)
        await Effect.runPromise(
          input.terminal.runWithMutationFence(
            record.scope,
            Effect.promise(() => {
              acquiredNativeFence = true
              acquired.resolve()
              return release.promise
            }),
          ),
        )
      })().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      try {
        releaseBrowser()
      } catch (error) {
        browserReleaseFailed = true
        if (!terminalOutcome.ok)
          throw new AggregateError(
            [terminalOutcome.error, error],
            'Native desktop fence settlement failed.',
            { cause: error },
          )
        throw error
      }
      if (!terminalOutcome.ok) throw terminalOutcome.error
    })().catch((error: unknown) => {
      acquired.reject(error)
      if (acquiredNativeFence || browserReleaseFailed) throw error
    })
    // Observe failures immediately, retaining the rejecting promise as the release proof.
    void finished.catch((error: unknown) => acquired.reject(error))
    // Reserve local browser admission before the asynchronous native drain can yield.
    held.set(record.token, {
      record,
      acquired: acquired.promise,
      finished,
      release: release.resolve,
    })
    await acquired.promise
  }

  async function reconcile(records: readonly DesktopFenceRecord[]) {
    const released: DesktopFenceRecord[] = []
    for (const record of records) {
      if (record.state === 'active') {
        await ensure(record)
        continue
      }
      const fence = held.get(record.token)
      if (fence) {
        if (!sameFence(fence.record, record))
          throw new Error('Released desktop fence identity changed.')
        fence.release()
        await fence.finished
        held.delete(record.token)
      }
      released.push(record)
    }
    for (const token of held.keys()) {
      if (!records.some((record) => record.token === token)) {
        throw new Error(
          'An outstanding desktop fence is missing from the Host journal. Reconcile the interrupted operation before continuing.',
        )
      }
    }
    return { released, activeTokens: [...held.keys()] }
  }

  return {
    reconcile,
    hasActive: () => held.size !== 0,
    blocks: (command: DesktopServiceCommand) =>
      [...held.values()].some((fence) => desktopCommandTouchesFence(command, fence.record)),
    acknowledge: (record: DesktopFenceRecord) => {
      const fence = held.get(record.token)
      if (!fence || !sameFence(fence.record, record))
        throw new Error('Desktop fence is not active in the reconciled journal.')
      return fence.acquired
    },
  }
}
