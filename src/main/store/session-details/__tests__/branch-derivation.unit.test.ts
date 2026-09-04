import { describe, expect, it } from 'vitest'
import { deriveSessionBranchesForSnapshot } from '../branch-derivation'

describe('deriveSessionBranchesForSnapshot', () => {
  it('adopts the active head as main when a replacement snapshot no longer contains the old main head', () => {
    const sessionId = 'replacement-session'
    const result = deriveSessionBranchesForSnapshot({
      sessionId,
      activeNodeId: 'new-assistant',
      existingBranches: [
        {
          id: `${sessionId}:main`,
          session_id: sessionId,
          source_node_id: null,
          head_node_id: 'missing-old-head',
          name: 'main',
          is_main: 1,
          archived_at: null,
          created_at: 1,
          updated_at: 1,
        },
      ],
      nodes: [
        {
          id: 'new-user',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 2,
          contentJson: JSON.stringify({ parts: [{ type: 'text', text: 'New question' }] }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'new-assistant',
          parentId: 'new-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 3,
          contentJson: JSON.stringify({ parts: [{ type: 'text', text: 'New answer' }] }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
      ],
    })

    expect(result).toMatchObject({
      activeBranchId: `${sessionId}:main`,
      activeNodeId: 'new-assistant',
      branches: [
        {
          id: `${sessionId}:main`,
          headNodeId: 'new-assistant',
          isMain: true,
        },
      ],
    })
  })
})
