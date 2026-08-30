import { describe, expect, it } from 'vitest'
import { applicationCliStdout } from '../electron-cli-stdout'

describe('Electron CLI stdout normalization', () => {
  it('removes only empty Linux startup payloads before the application response', () => {
    const response = '{"result":{"response":{}}}\n'

    expect(applicationCliStdout(`[]\n{}\n[]\n${response}`, 'linux')).toBe(response)
  })

  it('preserves non-empty Linux stdout contamination so the JSON contract fails closed', () => {
    const stdout = '["unexpected"]\n{"result":{}}\n'

    expect(applicationCliStdout(stdout, 'linux')).toBe(stdout)
  })

  it('does not normalize stdout on other platforms', () => {
    const stdout = '[]\n{"result":{}}\n'

    expect(applicationCliStdout(stdout, 'win32')).toBe(stdout)
  })
})
