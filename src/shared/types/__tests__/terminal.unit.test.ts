import { describe, expect, it } from 'vitest'
import { terminalKeyOf } from '../terminal'

describe('terminalKeyOf', () => {
  it('allows delimiters in owner paths but reserves them in terminal ids', () => {
    expect(terminalKeyOf('draft:/tmp/project::copy', 'main')).toBe('draft:/tmp/project::copy::main')
    expect(() => terminalKeyOf('session-a', 'main::session-b')).toThrow(
      'Terminal ids cannot contain "::"',
    )
  })
})
