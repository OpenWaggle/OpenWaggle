import { describe, expect, it } from 'vitest'
import { repositoryWebUrl } from '../repository-web-url'

describe('repositoryWebUrl', () => {
  it('normalizes HTTPS remotes without treating the scheme colon as SCP syntax', () => {
    expect(repositoryWebUrl('https://github.com/OpenWaggle/OpenWaggle.git')).toBe(
      'https://github.com/OpenWaggle/OpenWaggle',
    )
  })

  it('normalizes SSH URL and SCP-style remotes', () => {
    expect(repositoryWebUrl('ssh://git@gitlab.com/group/project.git')).toBe(
      'https://gitlab.com/group/project',
    )
    expect(repositoryWebUrl('git@gitlab.com:group/project.git')).toBe(
      'https://gitlab.com/group/project',
    )
  })
})
