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

  it('shares an explicitly chosen extension association across repository worktrees', () => {
    setWorkspaceLanguagePatternAssociation(
      window.localStorage,
      '/repository',
      'src/one.waggle',
      'typescript',
    )

    expect(
      workspaceLanguageAssociation(window.localStorage, '/repository', 'other/two.waggle'),
    ).toBe('typescript')
    expect(
      workspaceLanguageAssociation(window.localStorage, '/repository', 'other/two.ts'),
    ).toBeNull()
  })
})
