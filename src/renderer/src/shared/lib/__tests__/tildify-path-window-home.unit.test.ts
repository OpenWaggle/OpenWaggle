import { describe, expect, it, vi } from 'vitest'
import { tildifyPath } from '../tildify-path'

vi.mock('../ipc', () => ({
  api: { getHomeDirectory: () => '/srv/people/dana' },
}))

describe('tildifyPath with the home directory the preload exposes', () => {
  it('shortens the preload home directory by default and guesses no other home', () => {
    expect(tildifyPath('/srv/people/dana/.openwaggle/mcp.json')).toBe('~/.openwaggle/mcp.json')
    expect(tildifyPath('/Users/bob/project')).toBe('/Users/bob/project')
  })
})
