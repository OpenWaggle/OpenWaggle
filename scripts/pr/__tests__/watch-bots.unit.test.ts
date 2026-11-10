import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../watch-snapshot'
import {
  bot,
  codexStateComment,
  HEAD_SHA,
  issueComment,
  NOW,
  OLD_SHA,
  prState,
  review,
} from './pr-state-fixtures'

describe('pr:watch bot reviews', () => {
  it('holds pushes while Codex is reviewing the head', () => {
    const eyes = buildSnapshot(
      prState({ reactions: [{ content: 'EYES', logins: ['chatgpt-codex-connector'] }] }),
      NOW,
    )
    const inProgress = buildSnapshot(
      prState({ comments: [codexStateComment({ sha: HEAD_SHA, status: 'in_progress' })] }),
      NOW,
    )

    expect(eyes.bots.inProgress).toEqual(['codex'])
    expect(eyes.canPush).toBe(false)
    expect(inProgress.actions).toEqual([{ reason: 'in progress: codex review', type: 'wait' }])
  })

  it('stops waiting on a Codex review that has looked busy for too long', () => {
    const snapshot = buildSnapshot(
      prState({
        comments: [
          codexStateComment({
            sha: HEAD_SHA,
            status: 'in_progress',
            updatedAt: '2026-11-10T10:00:00Z',
          }),
        ],
      }),
      NOW,
    )

    expect(snapshot.bots.codex.status).toBe('stalled')
    expect(snapshot.canPush).toBe(true)
  })

  it('reads a usage-limit reply as no review, warns, and does not wait', () => {
    const snapshot = buildSnapshot(
      prState({
        comments: [
          codexStateComment({ sha: HEAD_SHA, status: 'failed', unresolved: true }),
          issueComment({
            author: bot('chatgpt-codex-connector'),
            body: 'You have reached your Codex usage limits for code reviews.',
            createdAt: '2026-11-10T11:30:20Z',
            id: 3,
          }),
        ],
      }),
      NOW,
    )

    expect(snapshot.bots.codex.status).toBe('usage_limited')
    expect(snapshot.openItems).toEqual([])
    expect(snapshot.actions).toEqual([{ type: 'converged' }])
    expect(snapshot.warnings).toContain(
      'Codex hit its usage limits, so no Codex review happened for this commit.',
    )
  })

  it('does not block on a missing Codex review and reports an older attempt', () => {
    const snapshot = buildSnapshot(
      prState({ comments: [codexStateComment({ sha: OLD_SHA, status: 'completed' })] }),
      NOW,
    )

    expect(snapshot.bots.codex).toEqual({
      lastAttempt: { outcome: 'clean', sha: OLD_SHA },
      status: 'none',
    })
    expect(snapshot.actions).toEqual([{ type: 'converged' }])
  })

  it('reports a completed Codex review of the head with findings', () => {
    const snapshot = buildSnapshot(
      prState({
        comments: [codexStateComment({ sha: HEAD_SHA, status: 'completed', unresolved: true })],
      }),
      NOW,
    )

    expect(snapshot.bots.codex.status).toBe('findings')
  })

  it('waits on a requested Copilot review and reports a finished one', () => {
    const requested = buildSnapshot(
      prState({ reviewRequests: [bot('copilot-pull-request-reviewer')] }),
      NOW,
    )
    const reviewed = buildSnapshot(
      prState({
        reviews: [
          review({ author: bot('copilot-pull-request-reviewer'), body: 'Pull request overview' }),
        ],
      }),
      NOW,
    )

    expect(requested.bots.inProgress).toEqual(['copilot'])
    expect(reviewed.bots.copilot).toBe('reviewed')
    expect(reviewed.openItems).toEqual([])
  })
})
