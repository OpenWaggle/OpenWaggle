import type { DesktopServiceCommand, DesktopServiceResult } from '@shared/types/desktop-service'
import * as Effect from 'effect/Effect'
import type { DesktopFenceRepositoryShape } from '../ports/desktop-fence-repository'
import type { DesktopOwnerRepositoryShape } from '../ports/desktop-owner-repository'
import type { DesktopServiceBrokerShape } from '../ports/desktop-service-broker'
import { DesktopServiceCommandQueue } from './desktop-service-command-queue'
import { desktopUnavailableError } from './desktop-service-errors'
import { DesktopServiceFences, isDesktopNativeFree } from './desktop-service-fences'
import { DesktopServiceLeases } from './desktop-service-leases'
import { desktopCommandTouchesFence } from './desktop-service-policy'

function asError(error: unknown) {
  return error instanceof Error ? error : new Error('Desktop operation failed.')
}

/** Single desktop owner; no native GUI/PTY service is constructed in the Session Host. */
export function makeDesktopServiceBroker(input: {
  readonly getHostInstanceId: () => string
  readonly fences: DesktopFenceRepositoryShape
  readonly owners: DesktopOwnerRepositoryShape
  readonly offlineExecute: (
    command: DesktopServiceCommand,
  ) => Effect.Effect<DesktopServiceResult, Error>
}): DesktopServiceBrokerShape {
  const queue = new DesktopServiceCommandQueue()
  const leases = new DesktopServiceLeases({ ...input, queue })
  const mutations = new DesktopServiceFences({ ...input, leases, queue, execute })

  async function execute(command: DesktopServiceCommand, signal: AbortSignal) {
    // Fence insertion and queue admission share one lock. Do not retain it while waiting
    // for a GUI response: the GUI must still be able to acknowledge completion/release.
    const admitted = await leases.admit(async () => {
      signal.throwIfAborted()
      const records = await leases.readFences()
      if (
        records.some(
          (record) => record.state === 'active' && desktopCommandTouchesFence(command, record),
        )
      ) {
        throw new Error(
          'This Session or Workspace has an active desktop mutation fence. Finish or recover that operation first.',
        )
      }
      const owner = leases.current()
      if (owner) {
        leases.require(owner.id, true)
        const existingAcquire =
          command.service === 'fence' && mutations.hasToken(command.record.token)
        if (owner.draining && !existingAcquire && !mutations.cleanupAllowed(command, records))
          throw desktopUnavailableError()
        return { result: queue.execute(command, owner.id, signal) }
      }
      if (!mutations.cleanupAllowed(command, records) || !(await isDesktopNativeFree(input.owners)))
        throw desktopUnavailableError()
      // Durable active fence predates this proof; any subsequent GUI registration must
      // restore that fence before opening native admission. Never infer proof from TTL.
      return { result: Effect.runPromise(input.offlineExecute(command), { signal }) }
    })
    return admitted.result
  }

  return {
    execute: (command) =>
      Effect.tryPromise({ try: (signal) => execute(command, signal), catch: asError }),
    handleGuiRequest: (request) =>
      Effect.tryPromise({ try: (signal) => leases.handle(request, signal), catch: asError }),
    runWithMutationFence: (scope, operation) => mutations.runWithMutationFence(scope, operation),
    close: () => leases.close(),
  }
}
