import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionBranch, SessionSummary } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { buildSessionProvenance } from '../session-provenance'

function branch(id: string, overrides: Partial<SessionBranch> = {}): SessionBranch {
  return {
    id: SessionBranchId(id),
    sessionId: SessionId('session-a'),
    sourceNodeId: null,
    headNodeId: null,
    name: id,
    isMain: id === 'main',
    createdAt: 0,
    ...overrides,
  }
}

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: SessionId('session-a'),
    title: 'Sidebar remodel',
    projectPath: '/Users/dev/openwaggle',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('buildSessionProvenance', () => {
  it('shows nothing for a plain local session with unknown git status', () => {
    expect(
      buildSessionProvenance({ session: session(), gitBranch: null, terminalCount: 0 }),
    ).toEqual([])
  })

  /**
   * The name is deliberately absent from the row. It was the widest element on the second
   * line, so it lives in the accessible name instead. See ADR 0020.
   */
  it('carries the branch name in the description, not as a count', () => {
    const [indicator] = buildSessionProvenance({
      session: session(),
      gitBranch: 'feat/sidebar-remodel',
      terminalCount: 0,
    })

    expect(indicator).toEqual({
      kind: 'git-branch',
      description: 'On branch feat/sidebar-remodel',
    })
  })

  it('ignores a blank branch name', () => {
    expect(
      buildSessionProvenance({ session: session(), gitBranch: null, terminalCount: 0 }),
    ).toEqual([])
  })

  it('marks a worktree session', () => {
    const kinds = buildSessionProvenance({
      session: session({ environmentMode: 'worktree' }),
      gitBranch: null,
      terminalCount: 0,
    }).map((indicator) => indicator.kind)

    expect(kinds).toEqual(['worktree'])
  })

  it('does not mark a local-mode session as a worktree', () => {
    const kinds = buildSessionProvenance({
      session: session({ environmentMode: 'local', worktreePath: '/tmp/leftover' }),
      gitBranch: null,
      terminalCount: 0,
    }).map((indicator) => indicator.kind)

    expect(kinds).toEqual([])
  })

  /**
   * A SessionBranch is a fork of the conversation, not a git branch, so the row shows a
   * count rather than names. One branch is the default shape and says nothing.
   */
  it('counts conversation branches only when there is more than one', () => {
    const single = buildSessionProvenance({
      session: session({ branches: [branch('main')] }),
      gitBranch: null,
      terminalCount: 0,
    })
    expect(single).toEqual([])

    const [indicator] = buildSessionProvenance({
      session: session({ branches: [branch('main'), branch('alt')] }),
      gitBranch: null,
      terminalCount: 0,
    })
    expect(indicator).toEqual({
      kind: 'conversation-branches',
      count: 2,
      description: '2 conversation branches',
    })
  })

  it('ignores archived conversation branches', () => {
    const indicators = buildSessionProvenance({
      session: session({
        branches: [branch('main'), branch('alt', { archived: true })],
      }),
      gitBranch: null,
      terminalCount: 0,
    })

    expect(indicators).toEqual([])
  })

  it('reports running terminals, with the singular for one', () => {
    expect(
      buildSessionProvenance({ session: session(), gitBranch: null, terminalCount: 1 })[0],
    ).toEqual({ kind: 'terminal', description: '1 terminal process running' })

    expect(
      buildSessionProvenance({ session: session(), gitBranch: null, terminalCount: 3 })[0],
    ).toEqual({ kind: 'terminal', description: '3 terminal processes running' })
  })

  /**
   * Cloning is real, but the lineage is never persisted on a session, so the row must not
   * guess. The render path exists and stays silent until the data does. See ADR 0020.
   */
  it('never claims a session was cloned, because the origin is not recorded', () => {
    const kinds = buildSessionProvenance({
      session: session({ environmentMode: 'worktree', branches: [branch('main'), branch('alt')] }),
      gitBranch: 'main',
      terminalCount: 2,
    }).map((indicator) => indicator.kind)

    expect(kinds).not.toContain('cloned-from')
  })

  /** Fixed order, so a row's second line does not reshuffle as facts arrive. */
  it('orders indicators branch, worktree, branches, terminals', () => {
    const kinds = buildSessionProvenance({
      session: session({
        environmentMode: 'worktree',
        branches: [branch('main'), branch('alt'), branch('third')],
      }),
      gitBranch: 'release/1.6.2',
      terminalCount: 1,
    }).map((indicator) => indicator.kind)

    expect(kinds).toEqual(['git-branch', 'worktree', 'conversation-branches', 'terminal'])
  })
})
