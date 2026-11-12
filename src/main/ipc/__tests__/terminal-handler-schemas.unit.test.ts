import { safeDecodeUnknown } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import { terminalOpenInputSchema } from '../terminal-handler-schemas'

/** The shared open input schema, refined in main with the check only Node can make. */
describe('terminal open input decoding', () => {
  const input = { ownerKey: 'session-1', terminalId: 't-1', cols: 80, rows: 24 }

  it('decodes an open input with an absolute Working path', () => {
    expect(safeDecodeUnknown(terminalOpenInputSchema, { ...input, cwd: '/project' })).toEqual({
      success: true,
      data: { ...input, cwd: '/project' },
    })
  })

  it('names the field a relative Working path fails', () => {
    expect(safeDecodeUnknown(terminalOpenInputSchema, { ...input, cwd: 'project' })).toEqual({
      success: false,
      issues: ['cwd: Terminal Working path must be absolute.'],
    })
  })
})
