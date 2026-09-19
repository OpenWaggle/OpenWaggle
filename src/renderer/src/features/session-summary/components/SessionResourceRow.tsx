import { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceOccurrence } from '@shared/types/session-resource'
import { ExternalLink, File, FolderSearch, Image, Link2 } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import {
  preferredResourceOccurrence,
  resolveResourceBranchName,
  resourceProvenanceLabel,
  type SessionResourceBranchNames,
  type SessionResourceBrowserView,
} from '../model/session-resource-browser'
import { SessionResourcePreview } from './SessionResourcePreview'

const LOCAL_RESOURCE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u
const RESOURCE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function originalResourcePath(locator: string | null) {
  return locator && LOCAL_RESOURCE_PATH.test(locator) ? locator : null
}

function ResourceIcon({ resource }: { readonly resource: SessionResource }) {
  if (resource.kind === 'image') return <Image className="size-4" />
  if (resource.kind === 'link' || resource.kind === 'site') return <Link2 className="size-4" />
  return <File className="size-4" />
}

function resourceStatusLabel(resource: SessionResource, originalPath: string | null) {
  if (!resource.available && originalPath) return 'Unavailable · Open original'
  if (!resource.available) return 'Unavailable'
  if (resource.managed && originalPath) return 'Managed copy · Original available'
  if (resource.isSource && resource.isOutput) return 'Source and output'
  return resource.isOutput ? 'Output' : 'Source'
}

function isResourceActionable(
  resource: SessionResource,
  originalPath: string | null,
  locator: string | null,
) {
  if (originalPath) return true
  if (locator?.startsWith('http')) return true
  if (!resource.available) return false
  return resource.kind === 'image' || resource.locator?.startsWith('session-resource://') === true
}

async function activateSessionResource(input: {
  readonly resource: SessionResource
  readonly sessionId: string
  readonly originalPath: string | null
  readonly locator: string | null
  readonly openViewer: (sessionId: string, resourceId: string) => void
}) {
  const { resource, sessionId, originalPath, locator, openViewer } = input
  if (resource.kind !== 'image' && originalPath) return api.openPath(originalPath)
  if (!resource.available && originalPath) return api.openPath(originalPath)
  if (resource.kind === 'image' && !resource.managed && locator?.startsWith('http://')) {
    return api.openExternal(locator)
  }
  if (resource.kind === 'image') {
    openViewer(sessionId, resource.id)
    return
  }
  if (locator?.startsWith('http')) return api.openExternal(locator)
  if (!resource.locator?.startsWith('session-resource://')) return
  const content = await api.readSessionResource(SessionId(sessionId), resource.id)
  if (!content) return
  const anchor = document.createElement('a')
  anchor.href = content.downloadUrl
  anchor.download = content.fileName
  anchor.click()
}

function resourceCanRetry(resource: SessionResource) {
  return !resource.available && !resource.canonicalKey.startsWith('unavailable-image:')
}

function occurrenceBranchName(
  occurrence: SessionResourceOccurrence | null,
  branchNames: SessionResourceBranchNames,
) {
  return occurrence?.branchId ? resolveResourceBranchName(occurrence.branchId, branchNames) : null
}

function OriginalResourceActions({
  resource,
  originalPath,
  onFailure,
}: {
  readonly resource: SessionResource
  readonly originalPath: string | null
  readonly onFailure: (cause: unknown) => void
}) {
  if (!originalPath) return null
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Open original ${resource.title}`}
        title="Open original"
        onClick={() => void api.openPath(originalPath).catch(onFailure)}
      >
        <ExternalLink className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Reveal original ${resource.title}`}
        title="Reveal original"
        onClick={() => void api.revealPath(originalPath).catch(onFailure)}
      >
        <FolderSearch className="size-3.5" />
      </Button>
    </>
  )
}

export function SessionResourceRow({
  resource,
  sessionId,
  onRetry,
  retrying = false,
  selected,
  view,
  branchNames,
  activePathNodeIds,
}: {
  readonly resource: SessionResource
  readonly sessionId: string
  readonly onRetry: () => void
  readonly retrying?: boolean
  readonly selected: boolean
  readonly view: SessionResourceBrowserView
  readonly branchNames: SessionResourceBranchNames
  readonly activePathNodeIds: ReadonlySet<string>
}) {
  const openViewer = useUIStore((state) => state.openResourceViewer)
  const showToast = useUIStore((state) => state.showToast)
  const occurrence = preferredResourceOccurrence(resource, activePathNodeIds, view)
  const locator = occurrence?.locator ?? resource.locator
  const originalPath = originalResourcePath(locator)
  const statusLabel = resourceStatusLabel(resource, originalPath)
  const branchName = occurrenceBranchName(occurrence, branchNames)

  const actionable = isResourceActionable(resource, originalPath, locator)
  const reportActionFailure = (cause: unknown) => {
    showToast(cause instanceof Error ? cause.message : 'Could not open this resource.', 'error')
  }

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
        onClick={() => {
          void activateSessionResource({
            resource,
            sessionId,
            originalPath,
            locator,
            openViewer,
          }).catch(reportActionFailure)
        }}
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
              {branchName ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="max-w-24 truncate font-mono">Branch {branchName}</span>
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
        {locator?.startsWith('http') ? (
          <ExternalLink className="size-3.5 shrink-0 text-text-tertiary" />
        ) : null}
      </Button>
      <OriginalResourceActions
        resource={resource}
        originalPath={originalPath}
        onFailure={reportActionFailure}
      />
      {resourceCanRetry(resource) ? (
        <Button
          variant="ghost"
          size="xs"
          className="mr-2"
          aria-label={`Retry ${resource.title}`}
          aria-disabled={retrying}
          onClick={() => {
            if (!retrying) onRetry()
          }}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      ) : null}
    </div>
  )
}
