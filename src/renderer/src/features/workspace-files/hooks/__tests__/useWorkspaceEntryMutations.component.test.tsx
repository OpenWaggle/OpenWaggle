// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import {
  setWorkspaceLanguageAssociation,
  workspaceLanguageAssociation,
} from '../../lib/workspace-language-associations'

const apiMock = vi.hoisted(() => ({
  moveWorkspaceEntry: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { useWorkspaceEntryMutations } from '../useWorkspaceEntryMutations'

describe('useWorkspaceEntryMutations language associations', () => {
  beforeEach(() => {
    window.localStorage.clear()
    apiMock.moveWorkspaceEntry.mockReset()
  })

  it('retargets an override within the active worktree only', async () => {
    setWorkspaceLanguageAssociation(
      window.localStorage,
      '/worktree-a',
      'src/previous.custom',
      'typescript',
    )
    setWorkspaceLanguageAssociation(
      window.localStorage,
      '/worktree-b',
      'src/previous.custom',
      'python',
    )
    apiMock.moveWorkspaceEntry.mockResolvedValue({
      previousPath: 'src/previous.custom',
      path: 'src/next.custom',
    })
    const { result } = renderHookWithQueryClient(() =>
      useWorkspaceEntryMutations({
        projectPath: '/worktree-a',
        relativePath: 'src/previous.custom',
        onOpenFile: vi.fn(),
        onClose: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.move('src/previous.custom', 'src/next.custom')
    })

    expect(
      workspaceLanguageAssociation(window.localStorage, '/worktree-a', 'src/previous.custom'),
    ).toBeNull()
    expect(
      workspaceLanguageAssociation(window.localStorage, '/worktree-a', 'src/next.custom'),
    ).toBe('typescript')
    expect(
      workspaceLanguageAssociation(window.localStorage, '/worktree-b', 'src/previous.custom'),
    ).toBe('python')
  })
})
