import { lazy, Suspense } from 'react'
import { ChatPanelContent } from '@/features/chat/components'
import { useChatPanelSections } from '@/features/chat/hooks'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { CHAT_MIN_WIDTH, DIFF_PANEL_MAX, DIFF_PANEL_MIN, useUIStore } from '@/shell'
import { useChatRouteEffects } from './-chat-route-effects'
import { resolveRightSidebarPanel } from './-right-sidebar-panel'

const DIFF_PANEL_DEFAULT_WIDTH = 600
const DIFF_PANEL_STORAGE_KEY = 'openwaggle:diff-sidebar-width'
const DIFF_PANEL_SHEET_BREAKPOINT_PX = 1180
const OVERFLOW_TOLERANCE_PX = 0.5

const LazyChatDiffPane = lazy(() =>
  import('@/features/chat/components').then((module) => ({
    default: module.ChatDiffPane,
  })),
)
const LazySessionTreePanel = lazy(() =>
  import('@/features/session-tree/components').then((module) => ({
    default: module.SessionTreePanel,
  })),
)

interface ChatRouteSurfaceProps {
  readonly branchId: string | null
  readonly diffOpen: boolean
  readonly nodeId: string | null
  readonly sessionId: string | null
  readonly sessionTreeOpen: boolean
  readonly onDiffOpenChange: (open: boolean) => void
  readonly onSessionTreeOpenChange: (open: boolean) => void
}

function DiffSidebarFallback() {
  return (
    <output
      className="flex size-full items-center justify-center bg-diff-bg text-[13px] text-text-tertiary"
      aria-live="polite"
    >
      Loading diff…
    </output>
  )
}

function shouldAcceptDiffWidth(input: {
  readonly nextWidth: number
  readonly panel: HTMLDivElement
  readonly root: HTMLDivElement
  readonly sidebar: HTMLDivElement
}) {
  const previousPanelWidth = input.panel.style.width
  const previousSidebarWidth = input.sidebar.style.width
  input.panel.style.setProperty('width', `${String(input.nextWidth)}px`)
  input.sidebar.style.setProperty('width', `${String(input.nextWidth)}px`)

  const mainWidth = input.root.clientWidth - input.nextWidth
  const composerForm = input.root.querySelector<HTMLElement>('[data-chat-composer-form="true"]')
  const composerFits = composerForm
    ? composerForm.scrollWidth <= composerForm.clientWidth + OVERFLOW_TOLERANCE_PX
    : true
  const accepted = mainWidth >= CHAT_MIN_WIDTH && composerFits

  restoreInlineWidth(input.panel, previousPanelWidth)
  restoreInlineWidth(input.sidebar, previousSidebarWidth)
  return accepted
}

function restoreInlineWidth(element: HTMLElement, previousWidth: string) {
  if (previousWidth.length > 0) {
    element.style.setProperty('width', previousWidth)
    return
  }
  element.style.removeProperty('width')
}

export function ChatRouteSurface({
  branchId,
  diffOpen,
  nodeId,
  sessionId,
  sessionTreeOpen,
  onDiffOpenChange,
  onSessionTreeOpenChange,
}: ChatRouteSurfaceProps) {
  const sections = useChatPanelSections()
  const lastRightSidebarPanel = useUIStore((state) => state.lastRightSidebarPanel)
  const setLastRightSidebarPanel = useUIStore((state) => state.setLastRightSidebarPanel)
  const renderedRightSidebarPanel = resolveRightSidebarPanel({
    diffOpen,
    lastPanel: lastRightSidebarPanel,
    sessionTreeOpen,
  })

  useChatRouteEffects({ branchId, diffOpen, nodeId, sessionId })

  function handleDiffOpenChange(open: boolean) {
    setLastRightSidebarPanel('diff')
    onDiffOpenChange(open)
  }

  function handleSessionTreeOpenChange(open: boolean) {
    setLastRightSidebarPanel('session-tree')
    onSessionTreeOpenChange(open)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <PanelErrorBoundary name="Chat" className="flex min-w-0 flex-1 overflow-hidden">
        <RightSidebarLayout
          open={diffOpen || sessionTreeOpen}
          sizing={{
            defaultWidth: DIFF_PANEL_DEFAULT_WIDTH,
            mainMinWidth: CHAT_MIN_WIDTH,
            maxWidth: DIFF_PANEL_MAX,
            minWidth: DIFF_PANEL_MIN,
            sheetBreakpointPx: DIFF_PANEL_SHEET_BREAKPOINT_PX,
            storageKey: DIFF_PANEL_STORAGE_KEY,
          }}
          onOpenChange={(open) => {
            if (renderedRightSidebarPanel === 'diff') {
              handleDiffOpenChange(open)
              return
            }
            handleSessionTreeOpenChange(open)
          }}
          shouldAcceptWidth={shouldAcceptDiffWidth}
          sidebar={
            <Suspense fallback={<DiffSidebarFallback />}>
              {renderedRightSidebarPanel === 'session-tree' ? (
                <LazySessionTreePanel onClose={() => handleSessionTreeOpenChange(false)} />
              ) : (
                <LazyChatDiffPane
                  section={sections.diff}
                  onClose={() => handleDiffOpenChange(false)}
                />
              )}
            </Suspense>
          }
        >
          <ChatPanelContent
            sections={sections}
            onOpenSessionTree={() => handleSessionTreeOpenChange(true)}
          />
        </RightSidebarLayout>
      </PanelErrorBoundary>
    </div>
  )
}
