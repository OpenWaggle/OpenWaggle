import type { SourceControlRepositoryIdentity } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import {
  githubRepositorySelector,
  gitlabRepositorySelector,
  repositoryBoundChangeRequestReference,
  resolveRepositoryChangeRequestIdentity,
} from '../repository-context'

const GITHUB_ENTERPRISE = {
  provider: 'github',
  host: 'github.example.test:8443',
  owner: 'Team',
  repository: 'Project',
} satisfies SourceControlRepositoryIdentity

const GITLAB_NESTED = {
  provider: 'gitlab',
  host: 'gitlab.example.test',
  owner: 'parent/child',
  repository: 'project',
} satisfies SourceControlRepositoryIdentity

describe('source-control repository context', () => {
  it('builds provider selectors that include the exact custom host and repository', () => {
    expect(githubRepositorySelector(GITHUB_ENTERPRISE)).toBe(
      'github.example.test:8443/Team/Project',
    )
    expect(gitlabRepositorySelector(GITLAB_NESTED)).toBe(
      'https://gitlab.example.test/parent/child/project',
    )
  })

  it('canonicalizes only same-repository GitHub pull request URLs', () => {
    expect(
      resolveRepositoryChangeRequestIdentity(
        GITHUB_ENTERPRISE,
        'https://github.example.test:8443/Team/Project/pull/42?diff=split#discussion',
      ),
    ).toEqual({
      reference: '42',
      url: 'https://github.example.test:8443/Team/Project/pull/42',
    })
    expect(
      resolveRepositoryChangeRequestIdentity(
        GITHUB_ENTERPRISE,
        'https://github.example.test:8443/Team/Other/pull/42',
      ),
    ).toBeNull()
    expect(
      resolveRepositoryChangeRequestIdentity(
        GITHUB_ENTERPRISE,
        'https://github.attacker.test/Team/Project/pull/42',
      ),
    ).toBeNull()
  })

  it('recognizes nested GitLab namespaces without accepting sibling projects', () => {
    expect(
      resolveRepositoryChangeRequestIdentity(
        GITLAB_NESTED,
        'https://gitlab.example.test/parent/child/project/-/merge_requests/7',
      ),
    ).toEqual({
      reference: '7',
      url: 'https://gitlab.example.test/parent/child/project/-/merge_requests/7',
    })
    expect(
      resolveRepositoryChangeRequestIdentity(
        GITLAB_NESTED,
        'https://gitlab.example.test/parent/child/other/-/merge_requests/7',
      ),
    ).toBeNull()
  })

  it('accepts canonical GitHub casing without accepting a sibling repository', () => {
    expect(
      resolveRepositoryChangeRequestIdentity(
        GITHUB_ENTERPRISE,
        'https://github.example.test:8443/team/project/pull/42',
      ),
    ).toEqual({ reference: '42', url: 'https://github.example.test:8443/Team/Project/pull/42' })
    expect(
      repositoryBoundChangeRequestReference(
        GITHUB_ENTERPRISE,
        'https://github.example.test:8443/TEAM/PROJECT/pull/42',
      ),
    ).toBe('42')
    expect(
      resolveRepositoryChangeRequestIdentity(
        GITHUB_ENTERPRISE,
        'https://github.example.test:8443/team/project-other/pull/42',
      ),
    ).toBeNull()
    expect(
      resolveRepositoryChangeRequestIdentity(
        GITLAB_NESTED,
        'https://gitlab.example.test/Parent/child/project/-/merge_requests/7',
      ),
    ).toBeNull()
  })

  it('turns an approved URL into a local reference and rejects a foreign URL', () => {
    expect(
      repositoryBoundChangeRequestReference(
        GITLAB_NESTED,
        'https://gitlab.example.test/parent/child/project/-/merge_requests/7?view=parallel',
      ),
    ).toBe('7')
    expect(
      repositoryBoundChangeRequestReference(
        GITLAB_NESTED,
        'https://gitlab.example.test/parent/child/other/-/merge_requests/7',
      ),
    ).toBeNull()
    expect(repositoryBoundChangeRequestReference(GITLAB_NESTED, 'feature/current')).toBe(
      'feature/current',
    )
  })
})
