import { ArrowLeft, Globe2, SquareTerminal, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { RightPanelMaximizeButton } from '@/shared/ui/RightPanelMaximizeButton'
import { WorkspaceBrowserSurfaceTab } from './WorkspaceBrowserSurfaceTab'
import { WorkspaceBrowserTabContextMenu } from './WorkspaceBrowserTabContextMenu'
import type { BrowserPreviewTabState } from './workspace-panel-model'
import type { WorkspacePanelSurface } from './workspace-panel-store'

interface WorkspaceSurfaceTabsProps {
  readonly model: {
    readonly activeSurface: WorkspacePanelSurface
    readonly browserTabs: readonly BrowserPreviewTabState[]
    readonly canCreateTerminal: boolean
    /** A title replaces the browser tab strip for non-browser surfaces. */
    readonly title?: {
      readonly label: string
      readonly backLabel?: string
      readonly onBack?: () => void
    }
  }
  readonly actions: {
    readonly newBrowser: () => void
    readonly newTerminal: () => void
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
      {model.title ? (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {model.title.onBack ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Back to ${model.title.backLabel ?? 'previous panel'}`}
              title={`Back to ${model.title.backLabel ?? 'previous panel'}`}
              onClick={model.title.onBack}
            >
              <ArrowLeft className="size-3.5" />
            </Button>
          ) : null}
          <h2
            tabIndex={-1}
            data-right-sidebar-focus-target="true"
            className="truncate px-1 text-sm font-medium text-text-primary outline-none"
          >
            {model.title.label}
          </h2>
        </div>
      ) : (
        <div
          role="tablist"
          aria-label="Browser tabs"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
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
      )}
      <WorkspacePanelToolbar {...props} />
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

function WorkspacePanelToolbar({ model, actions }: WorkspaceSurfaceTabsProps) {
  return (
    <>
      {' '}
      {model.activeSurface?.kind === 'browser' ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New browser tab"
          title="New browser tab"
          onClick={actions.newBrowser}
        >
          <Globe2 className="size-3.5" />
        </Button>
      ) : null}
      {model.activeSurface?.kind === 'terminal' ? (
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
      ) : null}
      <RightPanelMaximizeButton />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Close side panel"
        title="Close side panel"
        onClick={actions.closePanel}
      >
        <X className="size-3.5" />
      </Button>
    </>
  )
}
