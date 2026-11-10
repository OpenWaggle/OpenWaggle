import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import { useUIStore } from '@/shell/ui-store'
import { makeMessage } from './ChatPanel.test-utils'
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
        session: { ...worker, lineage: undefined },
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

  it('orders gallery images by persisted transcript node identity', async () => {
    const resource = (
      id: string,
      title: string,
      nodeId: string,
      createdAt: number,
    ): SessionResource => ({
      id,
      sessionId: SessionId('session-1'),
      canonicalKey: `sha256:${id}`,
      kind: 'image',
      title,
      mimeType: 'image/png',
      locator: `session-resource://${id}`,
      managed: true,
      available: true,
      isSource: false,
      isOutput: true,
      occurrences: [
        {
          id: `occurrence-${id}`,
          nodeId,
          branchId: 'branch-1',
          actor: 'agent',
          activity: 'created',
          label: null,
          locator: `session-resource://${id}`,
          createdAt,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    })
    listSessionResources.mockResolvedValue({
      resources: [
        resource('hidden-image', 'hidden.png', 'hidden-node', 1),
        resource('active-image', 'active.png', 'persisted-node', 2),
      ],
      backfillComplete: true,
    })
    useUIStore.getState().openResourceViewer('session-1', 'active-image')
    const message = makeMessage({
      id: 'runtime-message-id',
      role: 'assistant',
      metadata: { sessionNodeId: 'persisted-node' },
    })

    renderPanel({ messages: [message] }, { isFirstMessage: false, session: SESSION })

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: active.png' }),
    ).toBeInTheDocument()
    expect(await screen.findByLabelText('Image provenance')).toHaveTextContent('1 of 2')
  })
})
