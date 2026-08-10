import type { GitBranchInfo } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import { buildBaseRefChoices, filterBaseRefChoices } from '../base-ref-choices'

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
      { id: 'local:main', label: 'main', local: 'main', remote: 'origin/main' },
      {
        id: 'remote:upstream/main',
        label: 'upstream/main',
        local: null,
        remote: 'upstream/main',
      },
    ])
  })

  it('surfaces local branches with no remote pairing', () => {
    const choices = buildBaseRefChoices([branch('feature/x'), branch('origin/main', true)])
    expect(choices).toEqual([
      { id: 'local:feature/x', label: 'feature/x', local: 'feature/x', remote: null },
      { id: 'remote:origin/main', label: 'origin/main', local: null, remote: 'origin/main' },
    ])
  })
})

describe('filterBaseRefChoices', () => {
  it('returns all choices for an empty query', () => {
    const choices = buildBaseRefChoices([branch('main')])
    expect(filterBaseRefChoices(choices, '   ')).toEqual(choices)
  })

  it('filters case-insensitively against label / local / remote', () => {
    const choices = buildBaseRefChoices([
      branch('main'),
      branch('feature/search'),
      branch('origin/main', true),
      branch('origin/feature/search', true),
    ])
    expect(filterBaseRefChoices(choices, 'SEARCH').map((choice) => choice.label)).toEqual([
      'feature/search',
    ])
    expect(filterBaseRefChoices(choices, 'origin/main').map((choice) => choice.label)).toEqual([
      'main',
    ])
  })
})
