import type { ChangeRequestOpenDestination, SourceControlProviderInfo } from '@shared/types/git'
import { ExternalLink, GitPullRequest, PanelRight } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Button } from '@/shared/ui/Button'
import {
  changeRequestProviderFromUrl,
  providerSiteLabel,
  urlHost,
} from '../model/change-request-attention'

/**
 * Where a Change request row goes. The primary activation follows the user's Change request open
 * destination; the secondary icon and Cmd/Ctrl-click take the other one. `destination` is null
 * until the Session Host answers, and rows stay inert until then.
 */
export interface ChangeRequestOpener {
  readonly destination: ChangeRequestOpenDestination | null
  readonly openInInspector: (url: string) => void
  readonly openOnWebsite: (url: string) => void
}

function openAt(opener: ChangeRequestOpener, url: string, alternate: boolean) {
  if (opener.destination === null) return
  const inspector = (opener.destination === 'inspector') !== alternate
  if (inspector) opener.openInInspector(url)
  else opener.openOnWebsite(url)
}

function isAlternateClick(event: MouseEvent) {
  return event.metaKey || event.ctrlKey
}

/** The current remote's provider, unless the request lives on another host. */
function requestProvider(url: string, remote: SourceControlProviderInfo | null) {
  const host = urlHost(url)
  if (remote && (host === null || host === remote.host.toLowerCase())) return remote.id
  return changeRequestProviderFromUrl(url)
}

export function ChangeRequestLinkRow({
  label,
  url,
  remote,
  opener,
}: {
  readonly label: string
  readonly url: string
  /** The Session remote's provider and host, used to name the provider site. */
  readonly remote: SourceControlProviderInfo | null
  readonly opener: ChangeRequestOpener
}) {
  const waiting = opener.destination === null
  const secondaryLabel =
    opener.destination === 'website'
      ? 'Open in OpenWaggle'
      : providerSiteLabel(requestProvider(url, remote), url)
  const SecondaryIcon = opener.destination === 'website' ? PanelRight : ExternalLink
  return (
    <div className="group flex min-h-8 items-center rounded-md transition-colors hover:bg-bg-hover focus-within:bg-bg-hover">
      <Button
        variant="unstyled"
        className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left aria-disabled:cursor-progress"
        aria-disabled={waiting ? true : undefined}
        onClick={(event) => openAt(opener, url, isAlternateClick(event))}
      >
        <span aria-hidden="true" className="shrink-0 text-text-tertiary">
          <GitPullRequest className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{label}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="mr-1 aria-disabled:cursor-progress"
        aria-label={secondaryLabel}
        title={secondaryLabel}
        aria-disabled={waiting ? true : undefined}
        onClick={() => openAt(opener, url, true)}
      >
        <SecondaryIcon className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}
