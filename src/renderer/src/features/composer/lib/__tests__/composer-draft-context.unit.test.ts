import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { buildComposerDraftContextKey } from '../composer-draft-context'

describe('buildComposerDraftContextKey', () => {
  it('scopes a new-session draft to the active project', () => {
    expect(
      buildComposerDraftContextKey({
        projectPath: '/tmp/project',
        sessionId: null,
      }),
    ).toBe('project:/tmp/project:new-session')
  })

  it('uses draft branch source nodes before materialized branch ids', () => {
    expect(
      buildComposerDraftContextKey({
        projectPath: '/tmp/project',
        sessionId: SessionId('session-1'),
        activeBranchId: SessionBranchId('branch-main'),
        draftSourceNodeId: SessionNodeId('node-draft'),
      }),
    ).toBe('project:/tmp/project:session:session-1:draft:node-draft')
  })

  it('scopes materialized branch drafts by branch id', () => {
    expect(
      buildComposerDraftContextKey({
        projectPath: '/tmp/project',
        sessionId: SessionId('session-1'),
        activeBranchId: SessionBranchId('branch-2'),
      }),
    ).toBe('project:/tmp/project:session:session-1:branch:branch-2')
  })
})
