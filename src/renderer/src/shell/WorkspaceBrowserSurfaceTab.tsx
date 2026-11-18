import type { BrowserPreviewFavicon } from '@shared/types/browser-preview'
import { Globe2, Volume2, VolumeX, X } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

export interface WorkspaceBrowserSurfaceTabModel {
  readonly id: string
  readonly kind: 'launcher' | 'preview'
  readonly title: string
  readonly url: string
  readonly audioMuted: boolean
  readonly audible: boolean
  readonly favicon: BrowserPreviewFavicon | null
}

function BrowserTabFavicon({ favicon }: { readonly favicon: BrowserPreviewFavicon | null }) {
  return <BrowserTabFaviconAttempt key={favicon?.dataUrl ?? 'fallback'} favicon={favicon} />
}

function BrowserTabFaviconAttempt({ favicon }: { readonly favicon: BrowserPreviewFavicon | null }) {
  const [failed, setFailed] = useState(false)
  return favicon !== null && !failed ? (
    <img
      src={favicon.dataUrl}
      alt=""
      aria-hidden
      draggable={false}
      className="size-3 shrink-0 rounded-sm object-contain"
      onError={() => setFailed(true)}
    />
  ) : (
    <Globe2 className="size-3 shrink-0" aria-hidden />
  )
}

export function WorkspaceBrowserSurfaceTab(props: {
  readonly active: boolean
  readonly onClose: () => void
  readonly onOpenContextMenu: (position: { readonly x: number; readonly y: number }) => void
  readonly onSelect: () => void
  readonly onToggleMuted: () => void
  readonly tab: WorkspaceBrowserSurfaceTabModel
}) {
  const openContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    props.onOpenContextMenu({ x: event.clientX, y: event.clientY })
  }

  return (
    <div
      className={cn(
        'group flex h-7 min-w-24 max-w-44 shrink-0 items-center rounded text-xs text-text-tertiary',
        props.active && 'bg-bg-hover text-text-primary',
      )}
    >
      <Button
        role="tab"
        aria-selected={props.active}
        title={props.tab.url || 'New browser tab'}
        size="none"
        variant="unstyled"
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2"
        onClick={props.onSelect}
        onContextMenu={openContextMenu}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          props.onOpenContextMenu({ x: bounds.left, y: bounds.bottom })
        }}
      >
        <BrowserTabFavicon favicon={props.tab.favicon} />
        <span className="truncate">{props.tab.title}</span>
      </Button>
      {props.tab.kind === 'preview' && props.tab.audible ? (
        <Button
          size="none"
          variant="unstyled"
          aria-label={
            props.tab.audioMuted ? `Unmute ${props.tab.title}` : `Mute ${props.tab.title}`
          }
          title={props.tab.audioMuted ? 'Unmute tab' : 'Mute tab'}
          className="rounded p-0.5 text-text-tertiary hover:bg-bg-secondary hover:text-text-primary"
          onClick={props.onToggleMuted}
          onContextMenu={openContextMenu}
        >
          {props.tab.audioMuted ? (
            <VolumeX className="size-3" aria-hidden />
          ) : (
            <Volume2 className="size-3" aria-hidden />
          )}
        </Button>
      ) : null}
      <Button
        size="none"
        variant="unstyled"
        aria-label={`Close ${props.tab.title}`}
        title="Close preview"
        className="mr-1 rounded p-0.5 opacity-0 hover:bg-bg-secondary group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={props.onClose}
        onContextMenu={openContextMenu}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}
