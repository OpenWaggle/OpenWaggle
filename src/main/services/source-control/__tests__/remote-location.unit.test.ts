import { describe, expect, it } from 'vitest'
import { parseRemoteLocation } from '../remote-location'

describe('reading where a Git remote points', () => {
  it.each([
    ['git@github.com:acme/app.git', 'github.com', 'github.com', 'acme', 'app'],
    [
      'https://gitlab.acme.io:8443/group/sub/app.git',
      'gitlab.acme.io',
      'gitlab.acme.io:8443',
      'group/sub',
      'app',
    ],
    ['ssh://git@ssh.acme.io:2222/team/app.git', 'ssh.acme.io', 'ssh.acme.io', 'team', 'app'],
    ['https://GitHub.com/Acme/App', 'github.com', 'github.com', 'Acme', 'App'],
    ['git@gh_work:acme/app.git', 'gh_work', 'gh_work', 'acme', 'app'],
  ])('parses %s', (url, host, webAuthority, owner, repository) => {
    expect(parseRemoteLocation(url)).toMatchObject({ host, webAuthority, owner, repository })
  })

  it.each([
    'https://github;id;x/o/r',
    'ssh://git@gitlab`id`/g/p',
    'git@gitlab$(id):g/p.git',
    "git@host'x:g/p.git",
    'https://exa mple.com/o/r',
    '/srv/git/app.git',
    'C:/repos/app.git',
    'file:///srv/git/app.git',
  ])('rejects %s, whose host is not a plain hostname', (url) => {
    expect(parseRemoteLocation(url)).toBeNull()
  })
})
