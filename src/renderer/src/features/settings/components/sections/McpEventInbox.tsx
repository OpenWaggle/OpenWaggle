import type {
  McpEventRecord,
  McpEventSubscriptionState,
  McpGetSettingsInput,
  McpResourceDescriptor,
  McpServerSummary,
} from '@shared/types/mcp'
import { BellRing, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { setComposerTextValue } from '@/features/chat/lib'
import { eventDraftText } from '@/features/settings/lib/mcp-capability-formatters'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { StructuredPayload } from '@/shared/ui/StructuredPayload'
import { useUIStore } from '@/shell/ui-store'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function subscriptionFor(states: readonly McpEventSubscriptionState[], serverInstanceId: string) {
  return states.find((state) => state.serverInstanceId === serverInstanceId)
}

function resourceUrisFor(resources: readonly McpResourceDescriptor[], serverInstanceId: string) {
  const uris: string[] = []
  for (const resource of resources) {
    if (resource.serverInstanceId === serverInstanceId) uris.push(resource.uri)
  }
  return uris
}

export function McpEventInbox({
  context,
  servers,
  resources,
  enabled,
}: {
  readonly context: McpGetSettingsInput
  readonly servers: readonly McpServerSummary[]
  readonly resources: readonly McpResourceDescriptor[]
  readonly enabled: boolean
}) {
  const [subscriptions, setSubscriptions] = useState<readonly McpEventSubscriptionState[]>([])
  const [events, setEvents] = useState<readonly McpEventRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyServer, setBusyServer] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const showToast = useUIStore((state) => state.showToast)

  async function refresh() {
    setRefreshing(true)
    try {
      const [nextSubscriptions, nextEvents] = await Promise.all([
        api.listMcpEventSubscriptions(context),
        api.listMcpEvents(context),
      ])
      setSubscriptions(nextSubscriptions)
      setEvents(nextEvents)
      setLoaded(true)
    } catch (error) {
      showToast(`MCP Event Inbox needs attention: ${errorMessage(error)}`, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  async function setSubscription(server: McpServerSummary, active: boolean) {
    if (!active) {
      const confirmed = await api.showConfirm(
        `Stop receiving events from ${server.name}?`,
        'The Event Inbox subscription will stop, but remote tasks or other server work may continue independently.',
      )
      if (!confirmed) return
    }
    setBusyServer(server.instanceId)
    try {
      await api.setMcpEventSubscription({
        ...context,
        serverInstanceId: server.instanceId,
        enabled: active,
        resourceUris: active ? resourceUrisFor(resources, server.instanceId) : [],
      })
      await refresh()
    } catch (error) {
      showToast(`MCP event subscription needs attention: ${errorMessage(error)}`, 'error')
    } finally {
      setBusyServer(null)
    }
  }

  function createDraft(event: McpEventRecord) {
    setComposerTextValue(eventDraftText(event))
    showToast(`Editable draft created from ${event.serverLabel}; it was not sent.`, 'success')
  }

  return (
    <section aria-labelledby="mcp-event-inbox-heading" className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="size-4 text-text-secondary" />
            <h3 id="mcp-event-inbox-heading" className="text-base font-semibold text-text-primary">
              Event Inbox
            </h3>
          </div>
          <p className="mt-1 text-xs text-text-tertiary">
            Subscriptions are opt-in per server. Events stay local and never enter model context
            until you select one.
          </p>
        </div>
        <Button
          type="button"
          disabled={refreshing || !context.sessionId}
          leftIcon={<RefreshCw className="size-3" />}
          onClick={() => void refresh()}
        >
          {loaded ? 'Refresh inbox' : 'Open inbox'}
        </Button>
      </div>
      {loaded && (
        <McpEventInboxContents
          enabled={enabled}
          context={context}
          servers={servers}
          subscriptions={subscriptions}
          events={events}
          busyServer={busyServer}
          setSubscription={setSubscription}
          createDraft={createDraft}
        />
      )}
    </section>
  )
}

function McpEventInboxContents({
  enabled,
  context,
  servers,
  subscriptions,
  events,
  busyServer,
  setSubscription,
  createDraft,
}: {
  readonly enabled: boolean
  readonly context: McpGetSettingsInput
  readonly servers: readonly McpServerSummary[]
  readonly subscriptions: readonly McpEventSubscriptionState[]
  readonly events: readonly McpEventRecord[]
  readonly busyServer: string | null
  readonly setSubscription: (server: McpServerSummary, active: boolean) => Promise<void>
  readonly createDraft: (event: McpEventRecord) => void
}) {
  return (
    <>
      <div className="grid gap-2 md:grid-cols-2">
        {servers.map((server) => {
          const state = subscriptionFor(subscriptions, server.instanceId)
          const active = state?.active === true
          const blocked = !enabled || !context.sessionId || server.trusted !== 'trusted'
          return (
            <div
              key={server.instanceId}
              className="space-y-2 rounded-md border border-border bg-bg px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-text-primary">{server.name}</p>
                  <p className="text-xs text-text-muted">
                    {active ? state.mode.replaceAll('-', ' ') : 'Not subscribed'}
                  </p>
                </div>
                <Button
                  type="button"
                  disabled={busyServer === server.instanceId || (!active && blocked)}
                  onClick={() => void setSubscription(server, !active)}
                >
                  {active ? 'Stop events' : 'Start events'}
                </Button>
              </div>
              {state?.detail && <p className="text-xs text-text-tertiary">{state.detail}</p>}
              {!active && server.trusted !== 'trusted' && (
                <p className="text-xs text-warning">Trust this server before subscribing.</p>
              )}
            </div>
          )
        })}
      </div>
      {events.length === 0 && (
        <p className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted">
          No events received. Opening the inbox alone does not start any server subscription.
        </p>
      )}
      {events.map((event) => (
        <article
          key={event.id}
          className="space-y-2 rounded-md border border-border bg-bg px-3 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-text-primary">{event.kind}</p>
              <p className="text-xs text-text-muted">
                {event.serverLabel} · {new Date(event.receivedAt).toLocaleString()}
              </p>
            </div>
            <Button type="button" onClick={() => createDraft(event)}>
              Add to editable draft
            </Button>
          </div>
          <StructuredPayload value={event.payload} className="max-h-40" />
        </article>
      ))}
    </>
  )
}
