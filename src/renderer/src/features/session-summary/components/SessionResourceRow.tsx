import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { ExternalLink, File, Image, Link2 } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import {
  latestResourceOccurrence,
  resourceBranchLabel,
  resourceProvenanceLabel,
  type SessionResourceBrowserView,
} from '../model/session-resource-browser'
import { SessionResourcePreview } from './SessionResourcePreview'

const LOCAL_RESOURCE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u
const RESOURCE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function originalResourcePath(resource: SessionResource) {
  return !resource.available && resource.locator && LOCAL_RESOURCE_PATH.test(resource.locator)
    ? resource.locator
    : null
}

function ResourceIcon({ resource }: { readonly resource: SessionResource }) {
  if (resource.kind === 'image') return <Image className="size-4" />
  if (resource.kind === 'link' || resource.kind === 'site') return <Link2 className="size-4" />
  return <File className="size-4" />
}

function resourceStatusLabel(resource: SessionResource, originalPath: string | null) {
  if (originalPath) return 'Unavailable · Open original'
  if (!resource.available) return 'Unavailable'
  if (resource.isSource && resource.isOutput) return 'Source and output'
  return resource.isOutput ? 'Output' : 'Source'
}

function isResourceActionable(resource: SessionResource, originalPath: string | null) {
  if (originalPath) return true
  if (resource.locator?.startsWith('http')) return true
  if (!resource.available) return false
  return resource.kind === 'image' || resource.locator?.startsWith('session-resource://') === true
}

async function activateSessionResource(input: {
  readonly resource: SessionResource
  readonly sessionId: string
  readonly originalPath: string | null
  readonly openViewer: (sessionId: string, resourceId: string) => void
}) {
  const { resource, sessionId, originalPath, openViewer } = input
  if (originalPath) return api.openPath(originalPath)
  if (resource.kind === 'image' && resource.locator?.startsWith('http://')) {
    return api.openExternal(resource.locator)
  }
  if (resource.kind === 'image') {
    openViewer(sessionId, resource.id)
    return
  }
  if (resource.locator?.startsWith('http')) return api.openExternal(resource.locator)
  if (!resource.locator?.startsWith('session-resource://')) return
  const content = await api.readSessionResource(SessionId(sessionId), resource.id)
  if (!content) return
  const anchor = document.createElement('a')
  anchor.href = `data:${content.mimeType};base64,${content.dataBase64}`
  anchor.download = content.fileName
  anchor.click()
}

export function SessionResourceRow({
  resource,
  sessionId,
  onRetry,
  selected,
  view,
}: {
  readonly resource: SessionResource
  readonly sessionId: string
  readonly onRetry: () => void
  readonly selected: boolean
  readonly view: SessionResourceBrowserView
}) {
  const openViewer = useUIStore((state) => state.openResourceViewer)
  const originalPath = originalResourcePath(resource)
  const statusLabel = resourceStatusLabel(resource, originalPath)
  const occurrence = latestResourceOccurrence(resource, view)

  const actionable = isResourceActionable(resource, originalPath)

  return (
    <div
      className={cn(
        'group flex w-full items-center rounded-lg border bg-bg transition-colors hover:bg-bg-hover',
        selected ? 'border-accent' : 'border-border',
      )}
    >
      <Button
        variant="unstyled"
        className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
        disabled={!actionable}
        aria-current={selected ? 'true' : undefined}
        onClick={() =>
          void activateSessionResource({ resource, sessionId, originalPath, openViewer })
        }
      >
        <span className="size-11 shrink-0 overflow-hidden rounded-md border border-border text-text-tertiary">
          {resource.kind === 'image' ? (
            <SessionResourcePreview resource={resource} sessionId={sessionId} />
          ) : (
            <span className="flex size-full items-center justify-center">
              <ResourceIcon resource={resource} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-primary">
            {resource.title}
          </span>
          {occurrence ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-text-tertiary">
              <span className="truncate">
                {resourceProvenanceLabel(occurrence.activity, occurrence.actor, occurrence.label)}
              </span>
              {occurrence.branchId ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="max-w-24 truncate font-mono">
                    Branch {resourceBranchLabel(occurrence.branchId)}
                  </span>
                </>
              ) : null}
              <span aria-hidden="true">·</span>
              <time className="shrink-0" dateTime={new Date(occurrence.createdAt).toISOString()}>
                {RESOURCE_DATE_TIME_FORMATTER.format(new Date(occurrence.createdAt))}
              </time>
            </span>
          ) : (
            <span className="block text-xs text-text-tertiary">{statusLabel}</span>
          )}
        </span>
        {resource.locator?.startsWith('http') ? (
          <ExternalLink className="size-3.5 shrink-0 text-text-tertiary" />
        ) : null}
      </Button>
      {!resource.available ? (
        <Button
          variant="ghost"
          size="xs"
          className="mr-2"
          aria-label={`Retry ${resource.title}`}
          onClick={onRetry}
        >
          Retry
        </Button>
      ) : null}
    </div>
  )
}
