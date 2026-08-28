import { describe, expect, it } from 'vitest'
import { tildifyPath } from '../tildify-path'

describe('tildifyPath', () => {
  it('abbreviates a macOS home prefix to ~', () => {
    expect(tildifyPath('/Users/diego.garciabrisa/.openwaggle/mcp/state.json')).toBe(
      '~/.openwaggle/mcp/state.json',
    )
  })

  it('abbreviates a Linux home prefix to ~', () => {
    expect(tildifyPath('/home/diego/.pi/agent/mcp.json')).toBe('~/.pi/agent/mcp.json')
  })

  it('abbreviates a Windows home prefix to ~', () => {
    expect(tildifyPath('C:\\Users\\diego\\.openwaggle\\mcp.json')).toBe('~\\.openwaggle\\mcp.json')
  })

  it('handles a bare home directory', () => {
    expect(tildifyPath('/Users/diego')).toBe('~')
  })

  it('leaves non-home paths unchanged', () => {
    expect(tildifyPath('/opt/project/.mcp.json')).toBe('/opt/project/.mcp.json')
    expect(tildifyPath('/var/folders/tmp/x')).toBe('/var/folders/tmp/x')
    expect(tildifyPath('relative/path.json')).toBe('relative/path.json')
  })

  it('does not abbreviate system directories that are not home directories', () => {
    expect(tildifyPath('/Users/Shared/something/mcp.json')).toBe('/Users/Shared/something/mcp.json')
    expect(tildifyPath('C:\\Users\\Public\\file.json')).toBe('C:\\Users\\Public\\file.json')
    expect(tildifyPath('C:\\Users\\Default\\AppData\\f')).toBe('C:\\Users\\Default\\AppData\\f')
  })

  it('removes the OpenWaggle Session worktree storage prefix', () => {
    expect(
      tildifyPath(
        '/Users/diego/.openwaggle/worktrees/OpenWaggle/session-a/.agents/skills/review/SKILL.md',
      ),
    ).toBe('.agents/skills/review/SKILL.md')
  })
})
