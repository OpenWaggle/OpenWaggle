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
}

type SessionEntries = Pick<ExtensionContext['sessionManager'], 'getEntries'>

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

function persistedItemIds(
  sessionManager: SessionEntries,
  input: Pick<DurableContextDeliveryInput<unknown>, 'customType' | 'idsDetailKey'>,
) {
  const persisted = new Set<string>()
  for (const entry of sessionManager.getEntries()) {
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
    acknowledgePersisted(itemIds)
  }

  input.pi.on('session_start', (_event, context) => {
    sessionManager = context.sessionManager
    const pendingIds = input.pendingItems.map(input.itemId)
    acknowledgePersisted(pendingIds)
    deliver(input.pendingItems)
  })
  input.pi.on('agent_end', () => acknowledgePersisted(awaitingPersistence))
  input.pi.on('agent_settled', () => acknowledgePersisted(awaitingPersistence))

  return { deliver }
}
