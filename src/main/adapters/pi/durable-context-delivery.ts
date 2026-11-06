import type {
  CustomMessageEntry,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

export interface DurableContextMessage {
  readonly customType: string
  readonly content: string
  readonly display: boolean
  readonly details: Readonly<Record<string, unknown>>
}

interface DurableContextDeliveryInput<Item> {
  readonly pi: ExtensionAPI
  readonly pendingItems: readonly Item[]
  readonly itemId: (item: Item) => string
  readonly idsDetailKey: string
  readonly customType: string
  readonly buildMessage: (items: readonly Item[]) => DurableContextMessage
  readonly onDelivered: (itemIds: readonly string[]) => void
  /**
   * When an item counts as delivered. `persisted` (the default): once its entry is in the Pi
   * session. `model-request`: once a model request includes it, at the next `turn_start`. An entry
   * appended during a Run's final turn, or after it, is in the transcript but no request saw it,
   * so it stays pending in the outbox; for Worker results that is what wakes an idle parent.
   */
  readonly acknowledgeWhen?: 'persisted' | 'model-request'
}

type SessionEntries = Pick<ExtensionContext['sessionManager'], 'getEntries' | 'getBranch'>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function itemIdsFromEntry(
  entry: CustomMessageEntry,
  input: Pick<DurableContextDeliveryInput<unknown>, 'customType' | 'idsDetailKey'>,
) {
  if (entry.customType !== input.customType || !isRecord(entry.details)) return []
  const value = entry.details[input.idsDetailKey]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * Item ids already in the session. Read on the current branch when delivery means a model request
 * read it: an entry left on a branch the user moved away from is in no request of this Run.
 */
function persistedItemIds(
  sessionManager: SessionEntries,
  input: Pick<
    DurableContextDeliveryInput<unknown>,
    'customType' | 'idsDetailKey' | 'acknowledgeWhen'
  >,
) {
  const persisted = new Set<string>()
  const entries =
    input.acknowledgeWhen === 'model-request'
      ? sessionManager.getBranch()
      : sessionManager.getEntries()
  for (const entry of entries) {
    if (entry.type !== 'custom_message') continue
    for (const itemId of itemIdsFromEntry(entry, input)) persisted.add(itemId)
  }
  return persisted
}

/**
 * Bridges OpenWaggle's durable outbox to Pi's custom-message history.
 *
 * Startup delivery happens while Pi is idle, where sendMessage appends synchronously. Live
 * steering is acknowledged only after a later Pi boundary can observe the persisted entry.
 * A restarted run reconciles an entry written before an outbox acknowledgement, preventing
 * crash retries from injecting the same Host-authored context twice.
 */
export function installDurableContextDelivery<Item>(input: DurableContextDeliveryInput<Item>) {
  const acceptedIds = new Set<string>()
  const awaitingPersistence = new Set<string>()
  let sessionManager: SessionEntries | undefined

  const acknowledgePersisted = (candidateIds: Iterable<string>) => {
    if (!sessionManager) return
    const persisted = persistedItemIds(sessionManager, input)
    const delivered = [...candidateIds].filter((itemId) => persisted.has(itemId))
    if (delivered.length === 0) return
    for (const itemId of delivered) {
      acceptedIds.add(itemId)
      awaitingPersistence.delete(itemId)
    }
    input.onDelivered(delivered)
  }

  const onModelRequest = input.acknowledgeWhen === 'model-request'
  const acknowledgeNow = (candidateIds: Iterable<string>) => {
    if (!onModelRequest) acknowledgePersisted(candidateIds)
  }

  const deliver = (items: readonly Item[]) => {
    const fresh = items.filter((item) => !acceptedIds.has(input.itemId(item)))
    if (fresh.length === 0) return
    const itemIds = fresh.map(input.itemId)
    for (const itemId of itemIds) {
      acceptedIds.add(itemId)
      awaitingPersistence.add(itemId)
    }
    try {
      input.pi.sendMessage(input.buildMessage(fresh), {
        deliverAs: 'steer',
        triggerTurn: false,
      })
    } catch (error) {
      for (const itemId of itemIds) {
        acceptedIds.delete(itemId)
        awaitingPersistence.delete(itemId)
      }
      throw error
    }
    acknowledgeNow(itemIds)
  }

  input.pi.on('session_start', (_event, context) => {
    sessionManager = context.sessionManager
    const pendingIds = input.pendingItems.map(input.itemId)
    if (onModelRequest) {
      // Already in the session (a retried Run, or an entry no request saw): never sent twice,
      // and acknowledged with the rest at this Run's first request.
      const persisted = persistedItemIds(context.sessionManager, input)
      for (const itemId of pendingIds.filter((itemId) => persisted.has(itemId))) {
        acceptedIds.add(itemId)
        awaitingPersistence.add(itemId)
      }
    } else {
      acknowledgePersisted(pendingIds)
    }
    deliver(input.pendingItems)
  })
  if (onModelRequest) {
    input.pi.on('turn_start', () => acknowledgePersisted(awaitingPersistence))
  } else {
    input.pi.on('agent_end', () => acknowledgePersisted(awaitingPersistence))
    input.pi.on('agent_settled', () => acknowledgePersisted(awaitingPersistence))
  }

  return { deliver }
}
