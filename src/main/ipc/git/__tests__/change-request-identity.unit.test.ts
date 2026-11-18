import { describe, expect, it } from 'vitest'
import { resolveChangeRequestIdentity } from '../change-request-identity'

describe('resolveChangeRequestIdentity', () => {
  it.each([
    [
      'github' as const,
      'git@github.example.com:team/repo.git',
      'https://github.example.com/team/repo/pull/42?diff=split',
      { reference: '42', url: 'https://github.example.com/team/repo/pull/42' },
    ],
    [
      'gitlab' as const,
      'git@gitlab.example.com:group/sub/repo.git',
      'https://gitlab.example.com/group/sub/repo/-/merge_requests/9#note_1',
      { reference: '9', url: 'https://gitlab.example.com/group/sub/repo/-/merge_requests/9' },
    ],
  ])('accepts a %s request owned by the resolved repository', (provider, remote, url, expected) => {
    expect(resolveChangeRequestIdentity(remote, provider, url)).toEqual(expected)
  })

  it.each([
    ['github' as const, 'https://github.com/o/r.git', 'https://github.com/o/other/pull/1'],
    ['github' as const, 'https://github.com/o/r.git', 'https://evil.test/o/r/pull/1'],
    ['github' as const, 'https://github.com/o/r.git', 'https://github.com/o/r/issues/1'],
    [
      'gitlab' as const,
      'https://gitlab.com/o/r.git',
      'https://gitlab.com/o/r/-/merge_requests/not-a-number',
    ],
    ['gitlab' as const, 'https://gitlab.com/o/r.git', 'file:///o/r/-/merge_requests/1'],
  ])('rejects a request outside the exact repository identity', (provider, remote, url) => {
    expect(resolveChangeRequestIdentity(remote, provider, url)).toBeNull()
  })
})
