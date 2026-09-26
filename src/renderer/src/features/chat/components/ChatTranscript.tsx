import type { SessionId } from '@shared/types/brand'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { ReactNode } from 'react'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { useStableRowContext } from '../hooks/useStableRowContext'
import { CHAT_CONTENT_FRAME_CLASS } from '../lib/chat-content-layout'
import { readingPositionKey } from '../lib/transcript-reading-positions'
import type { ChatTranscriptSectionState } from '../model'
import { compactionTimelineLabel } from './CompactionTimelineRow'
import { TranscriptLoadingState } from './TranscriptLoadingState'
import { TranscriptViewport } from './TranscriptViewport'
import { WelcomeScreen } from './WelcomeScreen'

interface ChatTranscriptProps {
  readonly section: ChatTranscriptSectionState
  readonly renderVisibleMessageRows?: (nodeIds: readonly string[], rows: ReactNode) => ReactNode
}

function latestCompactionAnnouncement(rows: ChatTranscriptSectionState['chatRows']) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const candidate = rows[index]
    if (candidate?.type === 'compaction-status' && candidate.announce) {
      return compactionTimelineLabel(candidate.state)
    }
  }
  return ''
}

function TranscriptExtensionCards({
  activeSessionId,
  extensionRegistry,
  extensionProjectPaths,
  rowsLength,
}: {
  readonly activeSessionId: SessionId | null
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
  readonly rowsLength: number
}) {
  return (
    <div
      className={`${CHAT_CONTENT_FRAME_CLASS} pb-6`}
      data-chat-content-frame="transcript-extensions"
    >
      <ExtensionAgentLoopSurface
        fallback={null}
        input={{
          surface: 'transcript',
          transcript: {
            sessionId: activeSessionId ? String(activeSessionId) : null,
            projectPaths: extensionProjectPaths,
            messageCount: rowsLength,
            state: rowsLength > 0 ? 'active' : 'empty',
          },
        }}
        projectPaths={extensionProjectPaths}
        registry={extensionRegistry}
      />
    </div>
  )
}

/**
 * Whether the transcript area shows the Welcome screen, a hydrating Session, or its rows.
 *
 * "Not loaded yet" is never "empty": rendering the Welcome screen while a Session hydrated flashed
 * "Let's build" under the previous Session's title on every first visit (ADR 0036).
 */
function transcriptSurface(section: ChatTranscriptSectionState) {
  if (section.transcriptState === 'loading') return 'loading'
  if (section.messages.length === 0 && section.chatRows.length === 0 && !section.isLoading) {
    return 'welcome'
  }
  return 'rows'
}

export function ChatTranscript({ section, renderVisibleMessageRows }: ChatTranscriptProps) {
  const {
    isLoading,
    projectPath,
    recentProjects,
    activeSessionId,
    activeBranchId,
    chatRows: rows,
    onOpenProject,
    onSelectProjectPath,
    extensionRegistry,
    extensionProjectPaths,
  } = section
  const surface = transcriptSurface(section)
  const rowContext = useStableRowContext(section)

  if (surface === 'welcome') {
    return (
      <div className="flex flex-1 overflow-y-auto chat-scroll">
        <WelcomeScreen
          projectPath={projectPath}
          hasProject={!!projectPath}
          recentProjects={recentProjects}
          onOpenProject={() => {
            void onOpenProject()
          }}
          onSelectProjectPath={onSelectProjectPath}
        />
      </div>
    )
  }

  if (surface === 'loading') return <TranscriptLoadingState />

  const positionKey = readingPositionKey(
    activeSessionId ? String(activeSessionId) : 'draft',
    activeBranchId ? String(activeBranchId) : null,
  )

  return (
    <>
      <div aria-atomic="true" aria-live="polite" className="sr-only">
        {latestCompactionAnnouncement(rows)}
      </div>
      {/*
       * Keyed by Session and branch: each gets a fresh window built around its own saved reading
       * position, so a branch switch never slices the previous branch's rows.
       */}
      <TranscriptViewport
        key={positionKey}
        positionKey={positionKey}
        input={{
          rows,
          context: rowContext,
          isLoading,
          lastUserMessageId: section.lastUserMessageId,
          userDidSend: section.userDidSend,
          onUserDidSendConsumed: section.onUserDidSendConsumed,
          onToggleTurnFold: section.onToggleTurnFold,
          sessionCreatedAt: section.sessionCreatedAt ?? null,
        }}
        trailing={
          <TranscriptExtensionCards
            activeSessionId={activeSessionId}
            extensionRegistry={extensionRegistry}
            extensionProjectPaths={extensionProjectPaths}
            rowsLength={rows.length}
          />
        }
        renderVisibleMessageRows={renderVisibleMessageRows}
      />
    </>
  )
}
