import type { SessionId } from '@shared/types/brand'
import type { McpEventSubscriptionState } from '@shared/types/mcp'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { BellRing, RefreshCw } from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { SessionSummaryRow, SessionSummarySection } from './SessionSummaryPrimitives'

const SUBSCRIPTION_STALE_TIME_MS = 5_000

function activeSubscriptions(subscriptions: readonly McpEventSubscriptionState[]) {
  return subscriptions.filter((subscription) => subscription.active)
}

function sessionSummarySubscriptionsQueryOptions(input: {
  readonly sessionId: SessionId
  readonly projectPath: string | null
  readonly visible: boolean
}) {
  return queryOptions({
    queryKey: [
      'session-summary-subscriptions',
      String(input.sessionId),
      input.projectPath,
    ] as const,
    queryFn: () =>
      input.projectPath
        ? api.listMcpEventSubscriptions({
            projectPath: input.projectPath,
            sessionId: String(input.sessionId),
          })
        : Promise.resolve([]),
    enabled: input.visible && input.projectPath !== null,
    staleTime: SUBSCRIPTION_STALE_TIME_MS,
  })
}

export function SessionSummarySubscriptions({
  sessionId,
  projectPath,
  visible,
  expanded,
  onExpandedChange,
}: {
  readonly sessionId: SessionId
  readonly projectPath: string | null
  readonly visible: boolean
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
}) {
  const subscriptions = useQuery(
    sessionSummarySubscriptionsQueryOptions({ sessionId, projectPath, visible }),
  )
  const active = activeSubscriptions(subscriptions.data ?? [])

  if (!visible || !projectPath || (subscriptions.isPending && active.length === 0)) return null
  if (!subscriptions.isError && active.length === 0) return null

  return (
    <SessionSummarySection
      id="subscriptions"
      title="Subscriptions"
      count={active.length > 0 ? active.length : undefined}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      {subscriptions.isError ? (
        <SessionSummaryRow
          icon={<RefreshCw className="size-3.5" />}
          label="Retry subscriptions"
          ariaLabel="Retry subscriptions"
          value={<span className="text-xs text-error-text">Unavailable</span>}
          onClick={() => void subscriptions.refetch()}
        />
      ) : (
        active.map((subscription) => (
          <SessionSummaryRow
            key={subscription.serverInstanceId}
            icon={<BellRing className="size-3.5" />}
            label={subscription.serverLabel}
            value={
              <span
                className="max-w-35 truncate text-xs text-text-tertiary"
                title={subscription.detail}
              >
                {subscription.detail}
              </span>
            }
          />
        ))
      )}
    </SessionSummarySection>
  )
}
