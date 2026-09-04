import type { SessionResource } from '@shared/types/session-resource'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type {
  SessionResourceBranchNames,
  SessionResourceBrowserTarget,
  SessionResourceBrowserView,
  SessionResourceGroup,
} from '../model/session-resource-browser'
import { SessionResourceRow } from './SessionResourceRow'

interface SessionResourcesPanelBodyProps {
  readonly model: {
    readonly sessionId: string | null
    readonly target: SessionResourceBrowserTarget
    readonly filter: SessionResourceBrowserView
    readonly loading: boolean
    readonly failed: boolean
    readonly errorMessage: string | null
    readonly retryError: string | null
    readonly retryingId: string | null
    readonly resources: readonly SessionResource[]
    readonly visibleResources: readonly SessionResource[]
    readonly resourceGroups: readonly SessionResourceGroup[]
    readonly branchNames: SessionResourceBranchNames
  }
  readonly onRetryResource: (resourceId: string) => void
  readonly onRetryCatalog: () => void
  readonly onShowMore: () => void
}

export function SessionResourcesPanelBody({
  model,
  onRetryResource,
  onRetryCatalog,
  onShowMore,
}: SessionResourcesPanelBodyProps) {
  return (
    <div
      className={cn('min-h-0 flex-1 space-y-2 overflow-y-auto p-3', model.loading && 'opacity-60')}
    >
      {model.retryError ? (
        <p
          className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
          role="alert"
        >
          {model.retryError}
        </p>
      ) : null}
      {model.loading ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-text-tertiary"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Loading this session’s sources and outputs…
        </div>
      ) : null}
      {model.failed ? (
        <div
          role="alert"
          className="mx-1 flex flex-col items-center rounded-lg border border-border bg-bg-secondary px-5 py-8 text-center"
        >
          <CircleAlert className="mb-3 size-5 text-warning" aria-hidden="true" />
          <p className="text-sm font-medium text-text-primary">
            Couldn’t load this session’s sources and outputs.
          </p>
          <p className="mt-1 text-xs text-text-tertiary">{model.errorMessage}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            aria-label="Retry loading resources"
            onClick={onRetryCatalog}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {!model.failed &&
        model.resourceGroups.map((group) => (
          <section key={group.id} aria-labelledby={`session-resource-group-${group.id}`}>
            <h3
              id={`session-resource-group-${group.id}`}
              className="mb-1.5 flex items-center justify-between px-1 text-xs font-medium text-text-tertiary"
            >
              <span>{group.label}</span>
              <span className="tabular-nums" aria-hidden="true">
                {group.resources.length}
              </span>
            </h3>
            <div className="space-y-2">
              {group.resources.map((resource) => (
                <SessionResourceRow
                  key={resource.id}
                  resource={resource}
                  sessionId={model.sessionId ?? ''}
                  onRetry={() => onRetryResource(resource.id)}
                  retrying={model.retryingId === resource.id}
                  selected={resource.id === model.target.resourceId}
                  view={model.filter}
                  branchNames={model.branchNames}
                />
              ))}
            </div>
          </section>
        ))}
      {!model.failed && model.visibleResources.length < model.resources.length ? (
        <Button variant="ghost" className="w-full" onClick={onShowMore}>
          Show more ({model.resources.length - model.visibleResources.length})
        </Button>
      ) : null}
      {!model.loading && !model.failed && model.resources.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-text-tertiary">
          No resources in this view.
        </p>
      ) : null}
    </div>
  )
}
