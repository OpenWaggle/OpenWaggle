import { Globe2, Maximize2, Minimize2, SquareTerminal, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { WorkspaceBrowserSurfaceTab } from './WorkspaceBrowserSurfaceTab'
import { WorkspaceBrowserTabContextMenu } from './WorkspaceBrowserTabContextMenu'
import type { BrowserPreviewTabState } from './workspace-panel-model'
import type { WorkspacePanelSurface } from './workspace-panel-store'

interface WorkspaceSurfaceTabsProps {
  readonly model: {
    readonly activeSurface: WorkspacePanelSurface
    readonly browserTabs: readonly BrowserPreviewTabState[]
    readonly hasTerminal: boolean
    readonly canCreateTerminal: boolean
    readonly canMaximize: boolean
    readonly maximized: boolean
  }
  readonly actions: {
    readonly newBrowser: () => void
    readonly newTerminal: () => void
    readonly toggleMaximized: () => void
    readonly selectTerminal: () => void
    readonly selectBrowser: (previewId: string) => void
    readonly closeBrowsers: (previewIds: readonly string[]) => void
    readonly closePanel: () => void
    readonly setBrowserAudioMuted: (previewId: string, audioMuted: boolean) => void
  }
}

export function WorkspaceSurfaceTabs(props: WorkspaceSurfaceTabsProps) {
  const { actions, model } = props
  const [contextMenu, setContextMenu] = useState<{
    readonly tabId: string
    readonly x: number
    readonly y: number
  } | null>(null)
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg px-1.5">
      <div
        role="tablist"
        aria-label="Side panel surfaces"
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
      >
        {model.hasTerminal && (
          <Button
            role="tab"
            aria-selected={model.activeSurface?.kind === 'terminal'}
            size="xs"
            variant="ghost"
            className={cn(
              'h-7 shrink-0 gap-1.5 px-2',
              model.activeSurface?.kind === 'terminal' && 'bg-bg-hover text-text-primary',
            )}
            onClick={actions.selectTerminal}
          >
            <SquareTerminal className="size-3.5" />
            Terminal
          </Button>
        )}
        {model.browserTabs.map((tab) => {
          const active =
            model.activeSurface?.kind === 'browser' && model.activeSurface.previewId === tab.id
          return (
            <WorkspaceBrowserSurfaceTab
              key={tab.id}
              active={active}
              tab={tab}
              onSelect={() => actions.selectBrowser(tab.id)}
              onToggleMuted={() => actions.setBrowserAudioMuted(tab.id, !tab.audioMuted)}
              onClose={() => actions.closeBrowsers([tab.id])}
              onOpenContextMenu={({ x, y }) => {
                setContextMenu({ tabId: tab.id, x, y })
              }}
            />
          )
        })}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="New browser tab"
        title="New browser tab"
        onClick={actions.newBrowser}
      >
        <Globe2 className="size-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="New terminal in side panel"
        disabled={!model.canCreateTerminal}
        title={
          model.canCreateTerminal
            ? 'New terminal in side panel'
            : 'Open a project to use a terminal'
        }
        onClick={actions.newTerminal}
      >
        <SquareTerminal className="size-3.5" />
      </Button>
      {model.canMaximize && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={model.maximized ? 'Restore side panel' : 'Maximize side panel'}
          aria-pressed={model.maximized}
          title={model.maximized ? 'Restore side panel' : 'Maximize side panel'}
          onClick={actions.toggleMaximized}
        >
          {model.maximized ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Close side panel"
        title="Close side panel"
        onClick={actions.closePanel}
      >
        <X className="size-3.5" />
      </Button>
      {contextMenu !== null ? (
        <WorkspaceBrowserTabContextMenu
          model={{
            open: true,
            position: { x: contextMenu.x, y: contextMenu.y },
            tabIds: model.browserTabs.map((tab) => tab.id),
            targetId: contextMenu.tabId,
            targetAudioMuted:
              model.browserTabs.find((tab) => tab.id === contextMenu.tabId)?.audioMuted ?? false,
            targetMaterialized:
              model.browserTabs.find((tab) => tab.id === contextMenu.tabId)?.kind === 'preview',
          }}
          actions={{
            close: () => setContextMenu(null),
            closeTabs: actions.closeBrowsers,
            setAudioMuted: actions.setBrowserAudioMuted,
          }}
        />
      ) : null}
    </div>
  )
}
