// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  setWorkspaceLanguageAssociation,
  setWorkspaceLanguagePatternAssociation,
  workspaceLanguageAssociation,
} from '../workspace-language-associations'

describe('workspace language associations', () => {
  beforeEach(() => window.localStorage.clear())

  it('keeps an immediate picker override scoped to the exact file', () => {
    setWorkspaceLanguageAssociation(window.localStorage, '/repository', 'src/one.ts', 'python')

    expect(workspaceLanguageAssociation(window.localStorage, '/repository', 'src/one.ts')).toBe(
      'python',
    )
    expect(
      workspaceLanguageAssociation(window.localStorage, '/repository', 'src/sibling.ts'),
    ).toBeNull()
  })

  it('shares a pattern within one worktree without leaking it to another', () => {
    setWorkspaceLanguagePatternAssociation(
      window.localStorage,
      '/worktree-a',
      'src/one.waggle',
      'typescript',
    )

    expect(
      workspaceLanguageAssociation(window.localStorage, '/worktree-a', 'other/two.waggle'),
    ).toBe('typescript')
    expect(
      workspaceLanguageAssociation(window.localStorage, '/worktree-a', 'other/two.ts'),
    ).toBeNull()
    expect(
      workspaceLanguageAssociation(window.localStorage, '/worktree-b', 'other/two.waggle'),
    ).toBeNull()
  })
})
