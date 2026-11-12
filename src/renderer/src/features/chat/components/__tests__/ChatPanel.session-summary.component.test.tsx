import { SessionId } from '@shared/types/brand'
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import {
  advanceSessionResourceBackfill,
  findSessionSummary,
  listSessionResources,
  preloadSessionSummaryOverlay,
  renderPanel,
  renderPanelSettled,
  SESSION,
  setupChatPanelSessionSummaryHarness,
} from './chat-panel-session-summary.test-harness'
import * as Struct from 'effect/Struct'

describe('ChatPanel session summary', () => {
  preloadSessionSummaryOverlay()

  beforeEach(() => {
    setupChatPanelSessionSummaryHarness()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not show an empty summary for auxiliary rows before the first sent message', async () => {
    await renderPanelSettled(
      { chatRows: [{ type: 'phase-indicator', label: 'Thinking', elapsedMs: 123 }] },
      { isFirstMessage: true, session: SESSION },
    )
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    expect(advanceSessionResourceBackfill).not.toHaveBeenCalled()
    expect(listSessionResources).not.toHaveBeenCalled()
  })

  it('puts an empty Worker Hive in the Session Hub, not above the composer', async () => {
    useSessionStore.setState({
      sessions: [
        {
          id: SessionId('session-1'),
          title: 'Worker session',
          projectPath: '/test/project',
          createdAt: 1,
          updatedAt: 1,
          lineage: {
            role: 'worker',
            parentSessionId: SessionId('queen'),
            directWorkerCount: 0,
            activeDirectWorkerCount: 0,
          },
        },
      ],
    })
    await renderPanelSettled({}, { isFirstMessage: true, session: SESSION })
    expect(await findSessionSummary()).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Hive Sessions' })).toBeNull()
  })

  it('keeps an empty Worker Hub visible while an older session tree lacks lineage', async () => {
    const worker = {
      id: SessionId('session-1'),
      title: 'Worker session',
      projectPath: '/test/project',
      createdAt: 1,
      updatedAt: 1,
      lineage: {
        role: 'worker' as const,
        parentSessionId: SessionId('queen'),
        directWorkerCount: 0,
        activeDirectWorkerCount: 0,
      },
    }
    useSessionStore.setState({
      activeSessionTree: {
        session: Struct.omit(worker, 'lineage'),
        nodes: [],
        branches: [],
        branchStates: [],
        uiState: null,
      },
      sessions: [worker],
    })

    renderPanel({}, { isFirstMessage: true, session: SESSION })

    expect(await findSessionSummary()).toBeInTheDocument()
  })
})
