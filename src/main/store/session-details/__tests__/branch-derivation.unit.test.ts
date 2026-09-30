import { describe, expect, it } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import { deriveSessionBranchesForSnapshot } from '../branch-derivation'
import type { SessionBranchRow } from '../types'

function node(
  id: string,
  parentId: string | null,
  kind: ProjectedSessionNodeInput['kind'],
  createdOrder: number,
  text?: string,
): ProjectedSessionNodeInput {
  return {
    id,
    parentId,
    piEntryType: kind === 'custom' ? 'custom' : 'message',
    kind,
    role: kind === 'user_message' ? 'user' : kind === 'assistant_message' ? 'assistant' : null,
    timestampMs: createdOrder,
    contentJson: JSON.stringify(text ? { parts: [{ type: 'text', text }] } : {}),
    metadataJson: '{}',
    pathDepth: 0,
    createdOrder,
  }
}

function branchRow(
  sessionId: string,
  id: string,
  name: string,
  headNodeId: string,
  isMain: boolean,
): SessionBranchRow {
  return {
    id,
    session_id: sessionId,
    source_node_id: null,
    head_node_id: headNodeId,
    name,
    is_main: isMain ? 1 : 0,
    archived_at: null,
    created_at: 1,
    updated_at: 1,
  }
}

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

  it('gives a branch started inside a saved branch its own identity and name', () => {
    const sessionId = 'nested-session'
    const savedBranchId = `${sessionId}:branch:retry`
    const result = deriveSessionBranchesForSnapshot({
      sessionId,
      activeNodeId: 'summary',
      existingBranches: [
        branchRow(sessionId, `${sessionId}:main`, 'main', 'main-answer', true),
        branchRow(sessionId, savedBranchId, 'Branch 2', 'retry-answer', false),
      ],
      nodes: [
        node('first', null, 'user_message', 0, 'first'),
        node('first-answer', 'first', 'assistant_message', 1),
        node('before-second', 'first-answer', 'custom', 2),
        node('main-user', 'before-second', 'user_message', 3, 'second'),
        node('main-answer', 'main-user', 'assistant_message', 4),
        node('retry', 'before-second', 'custom', 5),
        node('retry-user', 'retry', 'user_message', 6, 'retried second'),
        node('retry-answer', 'retry-user', 'assistant_message', 7),
        // A retry of "retried second" with a summary, which forks inside Branch 2.
        node('summary', 'retry', 'branch_summary', 8),
      ],
    })

    const ids = result.branches.map((branch) => branch.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: savedBranchId,
          name: 'Branch 2',
          headNodeId: 'retry-answer',
        }),
        expect.objectContaining({ headNodeId: 'summary', name: 'Branch 3' }),
      ]),
    )
    expect(result.activeBranchId).not.toBe(savedBranchId)
  })
})
