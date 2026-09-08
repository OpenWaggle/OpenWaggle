import { match } from '@diegogbrisa/ts-match'
import { lazy, Suspense } from 'react'
import { loadChatDiffPane } from '@/features/chat/components'
import type { useChatPanelSections } from '@/features/chat/hooks'
import {
  ExtensionSidePanelSurface,
  type useExtensionSidePanelContributions,
} from '@/features/extensions'
import {
  ChangeRequestPanel,
  DEFAULT_SESSION_RESOURCE_BROWSER_TARGET,
  SessionResourcesPanel,
} from '@/features/session-summary'
import { loadSessionTreePanel } from '@/features/session-tree/components'
import { WorkspaceFilePanel } from '@/features/workspace-files/components'
import type { RightSidebarPanel } from '@/shell'
import type {
  ChatRightSidebarRouteState,
  ChatRouteSurfaceHandlers,
  ChatRouteWorkspaceState,
} from './-chat-route-surface'

const LazyChatDiffPane = lazy(loadChatDiffPane)
const LazySessionTreePanel = lazy(loadSessionTreePanel)

function SidebarFallback() {
  return (
    <output
      aria-label="Loading"
      className="flex size-full items-center justify-center bg-diff-bg text-sm text-text-tertiary"
      aria-live="polite"
    >
      Loading diff…
    </output>
  )
}

interface ChatRouteSidebarInput {
  readonly activePathNodeIds: ReadonlySet<string>
  readonly handlers: ChatRouteSurfaceHandlers
  readonly panel: RightSidebarPanel
  readonly rightSidebar: ChatRightSidebarRouteState
  readonly rightSidebarOpen: boolean
  readonly sections: ReturnType<typeof useChatPanelSections>
  readonly sidePanelQuery: ReturnType<typeof useExtensionSidePanelContributions>
  readonly workspace: ChatRouteWorkspaceState
}

export function ChatRouteSidebar({ input }: { readonly input: ChatRouteSidebarInput }) {
  return <Suspense fallback={<SidebarFallback />}>{renderSidebarPanel(input)}</Suspense>
}

function renderSidebarPanel(input: ChatRouteSidebarInput) {
  const { handlers, panel, rightSidebar, sections, workspace } = input
  const renderDiff = () => (
    <LazyChatDiffPane
      section={sections.diff}
      onClose={() => handlers.handleDiffOpenChange(false)}
    />
  )

  return match(panel)
    .with('change-request', () => (
      <ChangeRequestPanel
        sessionId={workspace.sessionId}
        workingPath={sections.diff.workingPath}
        requestUrl={rightSidebar.changeRequestUrl ?? null}
        open={input.rightSidebarOpen}
        onClose={() => handlers.handleChangeRequestOpenChange(false)}
        onSelectRequest={(url) => handlers.handleChangeRequestOpenChange(true, url)}
        onOpenDiff={() => handlers.handleDiffOpenChange(true)}
      />
    ))
    .with('session-tree', () => (
      <LazySessionTreePanel onClose={() => handlers.handleSessionTreeOpenChange(false)} />
    ))
    .with('resources', () => (
      <SessionResourcesPanel
        sessionId={workspace.sessionId}
        activeBranchId={workspace.branchId}
        activePathNodeIds={input.activePathNodeIds}
        target={rightSidebar.resourcesTarget ?? DEFAULT_SESSION_RESOURCE_BROWSER_TARGET}
        onClose={() => handlers.handleResourcesTargetChange(null)}
        onTargetChange={handlers.handleResourcesTargetChange}
      />
    ))
    .with('file', () =>
      rightSidebar.workspaceFile ? (
        <WorkspaceFilePanel
          key={sections.diff.workingPath ?? 'no-project'}
          projectPath={sections.diff.workingPath}
          relativePath={rightSidebar.workspaceFile.path}
          line={rightSidebar.workspaceFile.line}
          onClose={() => handlers.handleWorkspaceFileOpenChange(false)}
          onOpenFile={(path, line) => handlers.handleWorkspaceFileOpenChange(true, { path, line })}
        />
      ) : (
        renderDiff()
      ),
    )
    .with({ kind: 'extension-side-panel' }, (extensionPanel) => (
      <ExtensionSidePanelSurface
        error={input.sidePanelQuery.error?.message ?? null}
        loading={input.sidePanelQuery.loading}
        onClose={() => handlers.handleExtensionSidePanelOpenChange(false, extensionPanel)}
        onRefresh={() => void input.sidePanelQuery.refetch()}
        projectPaths={input.sidePanelQuery.projectPaths}
        registry={input.sidePanelQuery.registry}
        target={extensionPanel}
      />
    ))
    .with('diff', renderDiff)
    .exhaustive()
}
