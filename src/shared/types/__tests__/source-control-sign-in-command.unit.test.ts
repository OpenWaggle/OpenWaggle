import { describe, expect, it } from 'vitest'
import { sourceControlSignInCommand } from '../source-control'

describe('the CLI sign-in command', () => {
  it('signs in to a validated host', () => {
    expect(sourceControlSignInCommand('gitlab', 'Git.Acme.io')).toBe(
      'glab auth login --hostname git.acme.io',
    )
  })

  it('never puts a host that is not a plain hostname into the command', () => {
    expect(sourceControlSignInCommand('github', 'github;id;x')).toBe('gh auth login')
  })

  it('clears the provider token variables, which make the CLI refuse to sign in', () => {
    expect(sourceControlSignInCommand('github', 'github.com', 'posix')).toBe(
      'env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_ENTERPRISE_TOKEN gh auth login --hostname github.com',
    )
    expect(sourceControlSignInCommand('gitlab', 'git.acme.io', 'powershell')).toBe(
      'Remove-Item Env:GITLAB_TOKEN,Env:GITLAB_ACCESS_TOKEN,Env:GITLAB_PRIVATE_TOKEN -ErrorAction SilentlyContinue; glab auth login --hostname git.acme.io',
    )
  })
})
