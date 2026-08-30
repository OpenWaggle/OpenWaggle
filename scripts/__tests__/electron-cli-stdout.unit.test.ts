import { describe, expect, it } from 'vitest'
import { applicationCliStdout } from '../electron-cli-stdout'

describe('Electron CLI stdout normalization', () => {
  it('removes only empty Linux startup payloads before the application response', () => {
    const response = '{"result":{"response":{}}}\n'

    expect(applicationCliStdout(`[]\n{}\n[]\n${response}`, 'linux')).toBe(response)
  })

  it('removes SGR-colored empty Electron payloads before the application response', () => {
    const response = '{"result":{"response":{}}}\n'
    const stdout = `\u001B[90m[]\u001B[39m\n\u001B[90m{}\u001B[39m\n${response}`

    expect(applicationCliStdout(stdout, 'linux')).toBe(response)
  })

  it('preserves non-empty Linux stdout contamination so the JSON contract fails closed', () => {
    const stdout = '["unexpected"]\n{"result":{}}\n'

    expect(applicationCliStdout(stdout, 'linux')).toBe(stdout)
  })

  it('preserves preamble-only output when Electron exits before the application response drains', () => {
    expect(applicationCliStdout('[][]', 'linux')).toBe('[][]')
  })

  it('preserves arbitrary Linux diagnostics before a versioned response', () => {
    const response = '{\n  "schemaVersion": 1,\n  "result": {}\n}\n'
    const stdout = `[electron-diagnostic]\n${response}`

    expect(applicationCliStdout(stdout, 'linux')).toBe(stdout)
  })

  it('does not normalize stdout on other platforms', () => {
    const stdout = '[]\n{"result":{}}\n'

    expect(applicationCliStdout(stdout, 'win32')).toBe(stdout)
  })
})
