import { describe, expect, it } from 'vitest'
import { parsePiWaggleCommandArgs } from '../commands'

describe('pi-waggle command parser', () => {
  it('parses Waggle slash command arguments', () => {
    expect(parsePiWaggleCommandArgs('')).toEqual({ type: 'menu' })
    expect(parsePiWaggleCommandArgs('off')).toEqual({ type: 'disable' })
    expect(parsePiWaggleCommandArgs('code-review Review this')).toEqual({
      type: 'activate-preset',
      presetId: 'code-review',
      prompt: 'Review this',
    })
    expect(parsePiWaggleCommandArgs('new')).toEqual({ type: 'create-preset' })
    expect(parsePiWaggleCommandArgs('edit code-review')).toEqual({
      type: 'edit-preset',
      presetId: 'code-review',
    })
    expect(parsePiWaggleCommandArgs('config')).toEqual({ type: 'edit-config' })
    expect(parsePiWaggleCommandArgs('turns 12')).toEqual({
      type: 'edit-turns',
      maxTurns: '12',
    })
  })
})
