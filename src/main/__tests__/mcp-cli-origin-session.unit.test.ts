import { describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({ env: {} }))

const { parseMcpCliArguments } = await import('../mcp-cli-arguments')
const { parseServeIdentity } = await import('../mcp-cli-serve-identity')

function identity(origin: string) {
  return parseServeIdentity(
    parseMcpCliArguments(['--stdio', '--owner', '--origin-session', origin]),
    true,
  )
}

describe('mcp serve --origin-session', () => {
  it('accepts a Session link as the origin Session', () => {
    expect(identity('openwaggle://sessions/session-1')).toMatchObject({
      originSessionId: 'session-1',
    })
    expect(identity('session-1')).toMatchObject({ originSessionId: 'session-1' })
  })

  it('refuses an openwaggle URL that is not a Session link', () => {
    expect(() => identity('openwaggle://app/')).toThrow('--origin-session is not a Session link')
  })
})
