import { SessionId, SessionNodeId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  type LogEntry,
  sessionDetailFor,
  sessionWorkspaceFor,
} from '../../hooks/__tests__/compaction-marker-transcript.fixtures'
import { createBranchDraftSelection, shouldPromptForBranchSummary } from '../branch-from-message'
import { sessionToUIMessages } from '../chat-message-conversion'
import { getVisibleForkTargets } from '../session-fork-targets'

/*
 * ADR 0048: messages above a compaction marker stay in the transcript, and the actions on them go
 * through Pi's tree. A branch from one of them moves Pi's leaf to that entry, so the model gets
 * that branch's own context, which does not include the later compaction.
 */

const SESSION_ID = SessionId('compacted-session')

const LOG: readonly LogEntry[] = [
  { id: 'user-1', kind: 'user' },
  { id: 'assistant-1', kind: 'assistant' },
  { id: 'user-2', kind: 'user' },
  { id: 'assistant-2', kind: 'assistant' },
  { id: 'user-3', kind: 'user' },
  { id: 'assistant-3', kind: 'assistant' },
  // Summarizes the first two turns and keeps the third.
  { id: 'compaction-1', kind: 'compaction', firstKeptEntryId: 'user-3' },
  { id: 'user-4', kind: 'user' },
  { id: 'assistant-4', kind: 'assistant' },
]

const workspace = sessionWorkspaceFor(SESSION_ID, LOG, 2)
const messages = sessionToUIMessages(sessionDetailFor(SESSION_ID, LOG, 2))

describe('actions on messages above a compaction marker', () => {
  it('edits and resends a summarized prompt from its parent, prefilled', () => {
    expect(createBranchDraftSelection({ messages, workspace, messageId: 'user-2' })).toEqual({
      sourceNodeId: SessionNodeId('assistant-1'),
      routeNodeId: SessionNodeId('assistant-1'),
      prefillText: 'user-2',
    })
  })

  it('branches from a summarized answer at that answer', () => {
    expect(createBranchDraftSelection({ messages, workspace, messageId: 'assistant-1' })).toEqual({
      sourceNodeId: SessionNodeId('assistant-1'),
      routeNodeId: SessionNodeId('assistant-1'),
    })
  })

  it('offers to summarize the branch it leaves, compaction included', () => {
    expect(shouldPromptForBranchSummary(workspace, SessionNodeId('assistant-1'))).toBe(true)
  })

  it('offers every prompt on the branch as a fork target, newest first', () => {
    expect(getVisibleForkTargets(workspace).map((target) => String(target.entryId))).toEqual([
      'user-4',
      'user-3',
      'user-2',
      'user-1',
    ])
  })
})
