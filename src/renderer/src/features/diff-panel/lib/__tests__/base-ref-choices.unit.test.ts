import type { GitBranchInfo } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import { buildBaseRefChoices } from '../base-ref-choices'

function branch(name: string, isRemote = false): GitBranchInfo {
  return {
    name,
    fullName: isRemote ? `refs/remotes/${name}` : `refs/heads/${name}`,
    isCurrent: false,
    isRemote,
    upstream: null,
    ahead: 0,
    behind: 0,
  }
}

describe('buildBaseRefChoices', () => {
  it('pairs matching local and remote branches and prefers origin', () => {
    const choices = buildBaseRefChoices([
      branch('main'),
      branch('upstream/main', true),
      branch('origin/main', true),
    ])
    expect(choices).toEqual([
      { id: 'local:main', label: 'main' },
      { id: 'remote:upstream/main', label: 'upstream/main' },
    ])
  })

  it('surfaces local branches with no remote pairing', () => {
    const choices = buildBaseRefChoices([branch('feature/x'), branch('origin/main', true)])
    expect(choices).toEqual([
      { id: 'local:feature/x', label: 'feature/x' },
      { id: 'remote:origin/main', label: 'origin/main' },
    ])
  })
})
