import { describe, expect, it } from 'vitest'
import { parseSessionCopyCommand } from '../session-copy-command'

describe('session copy command parsing', () => {
  it('accepts the bare /fork command', () => {
    expect(parseSessionCopyCommand('/fork')).toEqual({ type: 'fork' })
  })

  it('accepts the bare /clone command', () => {
    expect(parseSessionCopyCommand('  /clone  ')).toEqual({ type: 'clone' })
  })

  it('rejects lookalike commands and commands with arguments', () => {
    expect(parseSessionCopyCommand('/fork now')).toBeNull()
    expect(parseSessionCopyCommand('/clone session-1')).toBeNull()
    expect(parseSessionCopyCommand('/forked')).toBeNull()
    expect(parseSessionCopyCommand('please /clone')).toBeNull()
  })
})
