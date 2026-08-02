import { describe, expect, it } from 'vitest'
import { parseGhAuthStatus, parseGlabAuthStatus } from '../auth-parse'

describe('auth-parse', () => {
  it('parses authenticated gh status with account + host', () => {
    const stderr = 'github.com\n  ✓ Logged in to github.com account octocat (keyring)\n'
    expect(parseGhAuthStatus('', stderr)).toEqual({
      authenticated: true,
      host: 'github.com',
      account: 'octocat',
    })
  })

  it('reports gh unauthenticated', () => {
    expect(parseGhAuthStatus('', 'You are not logged into any GitHub hosts.')).toEqual({
      authenticated: false,
      host: null,
      account: null,
    })
  })

  it('parses authenticated glab status', () => {
    const stderr = 'gitlab.com\n  ✓ Logged in to gitlab.com as octocat (...)\n'
    expect(parseGlabAuthStatus('', stderr)).toEqual({
      authenticated: true,
      host: 'gitlab.com',
      account: 'octocat',
    })
  })

  it('reports glab unauthenticated', () => {
    expect(parseGlabAuthStatus('', 'No authenticated hosts')).toEqual({
      authenticated: false,
      host: null,
      account: null,
    })
  })
})
