import { ArrowRight, Clock3, Radio } from 'lucide-react'
import { useMemo } from 'react'
import { useTerminalActivityStore } from '@/features/terminal'
import { Button } from '@/shared/ui/Button'
import { useBrowserPreviewRecentStore } from '../state/browser-preview-recent-store'

const VISIBLE_DESTINATION_LIMIT = 8

interface LocalServerDestination {
  readonly url: string
  readonly port: number
  readonly terminalId: string
  readonly processName: string | null
}

function localServerDestinations(
  ownerKey: string,
  summaries: ReturnType<typeof useTerminalActivityStore.getState>['summariesByKey'],
): readonly LocalServerDestination[] {
  const byUrl = new Map<string, LocalServerDestination>()
  for (const summary of summaries.values()) {
    if (summary.ownerKey !== ownerKey) continue
    for (const preview of summary.portPreviews ?? []) {
      if (byUrl.has(preview.url)) continue
      byUrl.set(preview.url, {
        url: preview.url,
        port: preview.port,
        terminalId: summary.terminalId,
        processName: summary.processName,
      })
    }
  }
  return [...byUrl.values()]
    .sort((left, right) => left.port - right.port || left.url.localeCompare(right.url))
    .slice(0, VISIBLE_DESTINATION_LIMIT)
}

function DestinationButton(props: {
  readonly description: string
  readonly icon: typeof Radio
  readonly label: string
  readonly onSelect: () => void
}) {
  const Icon = props.icon
  return (
    <Button
      type="button"
      variant="unstyled"
      className="group flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:border-border-light hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      onClick={props.onSelect}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-bg-secondary text-text-tertiary group-hover:text-text-primary">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-text-primary">{props.label}</span>
        <span className="block truncate text-xs text-text-tertiary">{props.description}</span>
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-text-muted group-hover:text-text-secondary" />
    </Button>
  )
}

export function BrowserPreviewLauncherDestinations(props: {
  readonly onSelect: (url: string) => void
  readonly ownerKey: string
  readonly tabId: string
}) {
  const summaries = useTerminalActivityStore((state) => state.summariesByKey)
  const recentUrls = useBrowserPreviewRecentStore((state) => state.entries)
  const servers = useMemo(
    () => localServerDestinations(props.ownerKey, summaries),
    [props.ownerKey, summaries],
  )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      <div className="mx-auto max-w-xl space-y-6">
        <header>
          <h2 className="text-base font-semibold text-text-primary">Open a preview</h2>
          <p className="mt-1 text-xs text-text-tertiary">
            Choose a live server from this Session or enter an address above.
          </p>
        </header>
        <LocalServerDestinations servers={servers} tabId={props.tabId} onSelect={props.onSelect} />
        {recentUrls.length > 0 ? (
          <section className="space-y-2" aria-labelledby={`recent-previews-${props.tabId}`}>
            <h3
              id={`recent-previews-${props.tabId}`}
              className="text-xs font-medium text-text-secondary"
            >
              Recent previews
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {recentUrls.slice(0, VISIBLE_DESTINATION_LIMIT).map((recent) => (
                <DestinationButton
                  key={recent.url}
                  icon={Clock3}
                  label={recent.title}
                  description={recent.url}
                  onSelect={() => props.onSelect(recent.url)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function LocalServerDestinations(props: {
  readonly onSelect: (url: string) => void
  readonly servers: readonly LocalServerDestination[]
  readonly tabId: string
}) {
  if (props.servers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-text-tertiary">
        Start a local server in this Session and it will appear here after it answers HTTP.
      </div>
    )
  }
  return (
    <section className="space-y-2" aria-labelledby={`local-servers-${props.tabId}`}>
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        <h3 id={`local-servers-${props.tabId}`} className="text-xs font-medium text-text-secondary">
          Live local servers
        </h3>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {props.servers.map((server) => (
          <DestinationButton
            key={server.url}
            icon={Radio}
            label={`localhost:${String(server.port)}`}
            description={server.processName ?? `Terminal ${server.terminalId}`}
            onSelect={() => props.onSelect(server.url)}
          />
        ))}
      </div>
    </section>
  )
}
