import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { GitStatusSummary } from '@shared/types/git'
import type { SessionBranch, SessionSummary } from '@shared/types/session'
import { type RenderResult, render } from '@testing-library/react'
import { vi } from 'vitest'
import type { SidebarSessionActions } from '../../model'
import { SessionListItem } from '../SessionListItem'

export const PROJECT = '/repo'
export const WORKTREE = '/home/dev/.openwaggle/worktrees/repo/session-a'
export const SESSION_ID = SessionId('session-a')
export const TITLE = 'Sidebar remodel with a fairly long session title'

export const qa = (name: string) => [...document.querySelectorAll(`[data-qa="${name}"]`)]
export const qaOne = (name: string) => document.querySelector(`[data-qa="${name}"]`)

export function status(overrides: Partial<GitStatusSummary> = {}) {
  const summary: GitStatusSummary = {
    branch: 'main',
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    changedFiles: [],
    clean: true,
    ahead: 0,
    behind: 0,
    ...overrides,
  }
  return summary
}

export function branch(id: string, overrides: Partial<SessionBranch> = {}) {
  const result: SessionBranch = {
    id: SessionBranchId(id),
    sessionId: SESSION_ID,
    sourceNodeId: null,
    headNodeId: null,
    name: id,
    isMain: id === 'main',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
  return result
}

export function session(extra: Partial<SessionSummary> = {}) {
  const summary: SessionSummary = {
    id: SESSION_ID,
    title: TITLE,
    projectPath: PROJECT,
    createdAt: 1,
    updatedAt: Date.now() - 4 * 60 * 60 * 1000,
    ...extra,
  }
  return summary
}

export function actions() {
  const result: SidebarSessionActions = {
    select: vi.fn(),
    delete: vi.fn(),
    archive: vi.fn(),
    markUnread: vi.fn(),
    togglePin: vi.fn(),
    clone: vi.fn(),
  }
  return result
}

export function renderRow(target: SessionSummary = session(), extra: Record<string, unknown> = {}) {
  const result: RenderResult = render(
    <ul>
      <SessionListItem session={target} actions={actions()} {...extra} />
    </ul>,
  )
  return result
}
