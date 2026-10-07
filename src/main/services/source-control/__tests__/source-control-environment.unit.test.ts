import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getSourceControlCliEnvForAccountToken,
  ignoredSourceControlTokenVariables,
} from '../source-control-environment'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('source-control CLI environment', () => {
  it('names the provider token variables OpenWaggle ignores', () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_secret')
    vi.stubEnv('GITLAB_TOKEN', '')

    expect(ignoredSourceControlTokenVariables('github')).toEqual(['GITHUB_TOKEN'])
    expect(ignoredSourceControlTokenVariables('gitlab')).toEqual([])
  })

  it.each([
    ['github.com', 'GH_TOKEN'],
    ['acme.ghe.com', 'GH_TOKEN'],
    ['github.acme.io', 'GH_ENTERPRISE_TOKEN'],
  ])('authenticates one gh account on %s through %s', (host, variable) => {
    const env = getSourceControlCliEnvForAccountToken('github', host, 'token')

    expect(env[variable]).toBe('token')
  })

  it('authenticates one glab account through GITLAB_TOKEN', () => {
    expect(
      getSourceControlCliEnvForAccountToken('gitlab', 'git.acme.io', 'token').GITLAB_TOKEN,
    ).toBe('token')
  })
})
