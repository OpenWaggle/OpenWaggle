import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingChangeRequestOutputsForTests,
  clearPendingCommitOutput,
  listPendingCommitOutputs,
  registerPendingCommitOutput,
} from '../session-change-request-output-retry'

describe('pending session output recording', () => {
  beforeEach(clearPendingChangeRequestOutputsForTests)

  it('keeps commit retries isolated to their originating session', () => {
    const first = SessionId('first-session')
    const second = SessionId('second-session')
    const commit = { commitHash: 'abc123', summary: 'Complete resource hub' }

    registerPendingCommitOutput(first, commit)

    expect(listPendingCommitOutputs(first)).toEqual([commit])
    expect(listPendingCommitOutputs(second)).toEqual([])
    clearPendingCommitOutput(first, commit.commitHash)
    expect(listPendingCommitOutputs(first)).toEqual([])
  })
})
