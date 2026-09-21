import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { PendingDelegationSpecificationUpdate } from '../../ports/session-orchestration-update-repository'
import { installDurableContextDelivery } from './durable-context-delivery'

const CUSTOM_TYPE = 'openwaggle-delegation-specification-update'

interface LiveSpecificationSink {
  readonly deliver: (updates: readonly PendingDelegationSpecificationUpdate[]) => void
}

const liveSinks = new Map<string, LiveSpecificationSink>()

function specificationMessage(updates: readonly PendingDelegationSpecificationUpdate[]) {
  return {
    customType: CUSTOM_TYPE,
    content: `OpenWaggle Host-authored Delegation specification update. Each revision replaces the prior contract for future work but grants no additional tools, filesystem access, network access, or approval authority.\n\n${updates
      .map((update) =>
        JSON.stringify({
          updateId: update.updateId,
          delegationId: update.delegationId,
          parentSessionId: update.parentSessionId,
          specificationRevision: update.specificationRevision,
          specification: update.specification,
          reason: update.reason,
        }),
      )
      .join('\n')}`,
    display: true,
    details: { updateIds: updates.map((update) => update.updateId) },
  } as const
}

function installLiveSink(
  pi: ExtensionAPI,
  runId: string,
  pendingUpdates: readonly PendingDelegationSpecificationUpdate[],
  onDelivered: (updateIds: readonly string[]) => void,
) {
  const delivery = installDurableContextDelivery({
    pi,
    pendingItems: pendingUpdates,
    itemId: (update) => update.updateId,
    idsDetailKey: 'updateIds',
    customType: CUSTOM_TYPE,
    buildMessage: specificationMessage,
    onDelivered,
  })
  const sink: LiveSpecificationSink = {
    deliver: delivery.deliver,
  }
  liveSinks.set(runId, sink)
  return () => {
    if (liveSinks.get(runId) === sink) liveSinks.delete(runId)
  }
}

export function createDelegationSpecificationUpdateExtension(input: {
  readonly runId: string
  readonly pendingUpdates: readonly PendingDelegationSpecificationUpdate[]
  readonly onDelivered: (updateIds: readonly string[]) => void
}): { readonly factory: ExtensionFactory; readonly close: () => void } {
  let close = () => {}
  const factory: ExtensionFactory = (pi) => {
    close = installLiveSink(pi, input.runId, input.pendingUpdates, input.onDelivered)
  }
  return { factory, close: () => close() }
}

export function deliverDelegationSpecificationUpdates(
  runId: string,
  updates: readonly PendingDelegationSpecificationUpdate[],
) {
  const sink = liveSinks.get(runId)
  if (!sink) return false
  sink.deliver(updates)
  return true
}
