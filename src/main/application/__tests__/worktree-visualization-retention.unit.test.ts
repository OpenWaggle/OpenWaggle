import { MessageId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionTree } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { sessionTreeReferencesWorktreeVisualization } from '../worktree-visualization-retention'

function treeWithText(text: string): SessionTree {
  const sessionId = SessionId('session-1')
  return {
    session: {
      id: sessionId,
      title: 'Visualization session',
      projectPath: '/project',
      createdAt: 1,
      updatedAt: 1,
    },
    nodes: [
      {
        id: SessionNodeId('assistant-map'),
        sessionId,
        parentId: null,
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 1,
        createdOrder: 0,
        pathDepth: 0,
        contentJson: '{}',
        metadataJson: '{}',
        message: {
          id: MessageId('assistant-map'),
          role: 'assistant',
          parts: [{ type: 'text', text }],
          createdAt: 1,
        },
      },
    ],
    branches: [],
    branchStates: [],
    uiState: null,
  }
}

describe('worktree visualization retention', () => {
  it('retains a worktree referenced from any projected branch node', () => {
    const reference = `visualize${JSON.stringify({ path: '/project/.openwaggle/worktrees/session-1/map.html' })}`
    expect(
      sessionTreeReferencesWorktreeVisualization(
        treeWithText(reference),
        '/project/.openwaggle/worktrees/session-1',
      ),
    ).toBe(true)
  })

  it('does not retain a worktree for unrelated sources', () => {
    const reference = `visualize${JSON.stringify({ path: '/tmp/visualizations/map.html' })}`
    expect(
      sessionTreeReferencesWorktreeVisualization(
        treeWithText(reference),
        '/project/.openwaggle/worktrees/session-1',
      ),
    ).toBe(false)
  })
})
