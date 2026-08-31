import { describe, expect, it } from 'vitest'
import { explicitWaggleTerminalResult } from '../explicit-waggle-command-result'

describe('explicitWaggleTerminalResult', () => {
  it('fails a nominally successful run that ended with an error before an assistant response', () => {
    expect(
      explicitWaggleTerminalResult({
        outcome: 'success',
        newMessages: [],
        lastError: 'provider stream failed',
      }),
    ).toEqual({ terminalStatus: 'failed' })
  })
})
