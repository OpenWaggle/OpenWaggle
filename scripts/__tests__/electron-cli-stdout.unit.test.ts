import { describe, expect, it } from 'vitest'
import { applicationCliStdout } from '../electron-cli-stdout'

describe('Electron CLI stdout normalization', () => {
  it('accepts one uncontaminated Linux application response', () => {
    const response = '{"schemaVersion":1,"type":"response"}\n'

    expect(applicationCliStdout(response, 'linux')).toBe(response)
  })

  it('removes only empty Linux startup payloads before the application response', () => {
    const response = '{"result":{"response":{}}}\n'

    expect(applicationCliStdout(`[]\n{}\n[]\n${response}`, 'linux')).toBe(response)
  })

  it('removes SGR-colored empty Electron payloads before the application response', () => {
    const response = '{"result":{"response":{}}}\n'
    const stdout = `\u001B[90m[]\u001B[39m\n\u001B[90m{}\u001B[39m\n${response}`

    expect(applicationCliStdout(stdout, 'linux')).toBe(response)
  })

  it('removes empty payloads wrapped in non-SGR ANSI control sequences', () => {
    const response = '{"result":{"response":{}}}\n'
    const stdout = `\u001B[?25l[]\u001B[?25h\u001B[2K${response}`

    expect(applicationCliStdout(stdout, 'linux')).toBe(response)
  })

  it('rejects non-empty Linux stdout contamination with an escaped diagnostic prefix', () => {
    const stdout = '["unexpected"]\n{"result":{}}\n'

    expect(() => applicationCliStdout(stdout, 'linux')).toThrow(JSON.stringify(stdout))
  })

  it('rejects preamble-only output when Electron exits before the application response drains', () => {
    expect(() => applicationCliStdout('[][]', 'linux')).toThrow(JSON.stringify('[][]'))
  })

  it('rejects arbitrary Linux diagnostics before a versioned response', () => {
    const response = '{\n  "schemaVersion": 1,\n  "result": {}\n}\n'
    const stdout = `[electron-diagnostic]\n${response}`

    expect(() => applicationCliStdout(stdout, 'linux')).toThrow(JSON.stringify(stdout))
  })

  it('rejects a long empty-token prefix when no application response follows', () => {
    const stdout = `${'[] \u001B[90m{}\u001B[39m\n'.repeat(1_000)}diagnostic`

    expect(() => applicationCliStdout(stdout, 'linux')).toThrow(
      JSON.stringify(stdout.slice(0, 256)),
    )
  })

  it('normalizes a long empty-token prefix in linear time when a valid response follows', () => {
    const response = '{"result":{"response":{}}}\n'
    const stdout = `${'[] \u001B[90m{}\u001B[39m\n'.repeat(1_000)}${response}`

    expect(applicationCliStdout(stdout, 'linux')).toBe(response)
  })

  it('rejects an empty-token prefix before an invalid object-shaped diagnostic', () => {
    const stdout = '[]\n{}\n{diagnostic}'

    expect(() => applicationCliStdout(stdout, 'linux')).toThrow(JSON.stringify(stdout))
  })

  it('removes known trailing empty Electron payloads after the application response', () => {
    const response = '{"result":{"message":"a } and ] inside a string"}}\n'
    const stdout = `[]\n${response}\u001B[90m{}\u001B[39m\n[]`

    expect(applicationCliStdout(stdout, 'linux')).toBe(response)
  })

  it('rejects unknown contamination after the application response', () => {
    const stdout = '[]\n{"result":{}}\ndiagnostic'

    expect(() => applicationCliStdout(stdout, 'linux')).toThrow(JSON.stringify(stdout))
  })

  it('does not normalize stdout on other platforms', () => {
    const stdout = '[]\n{"result":{}}\n'

    expect(applicationCliStdout(stdout, 'win32')).toBe(stdout)
  })
})
