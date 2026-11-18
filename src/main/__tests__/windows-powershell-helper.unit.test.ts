import { describe, expect, it } from 'vitest'
import {
  WINDOWS_POWERSHELL_HELPER_ARGUMENTS,
  windowsPowerShellExecutable,
  windowsPowerShellHelperInput,
  windowsPowerShellHelperOutput,
} from '../windows-powershell-helper'

describe('Windows PowerShell helper invocation', () => {
  it('carries only switches on the command line, nothing an antivirus heuristic flags', () => {
    expect(WINDOWS_POWERSHELL_HELPER_ARGUMENTS).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '-',
    ])
    const commandLine = WINDOWS_POWERSHELL_HELPER_ARGUMENTS.join(' ').toLowerCase()
    for (const flagged of ['-encodedcommand', '-enc', '-executionpolicy', 'bypass', 'hidden']) {
      expect(commandLine).not.toContain(flagged)
    }
  })

  it('starts Windows PowerShell by its absolute System32 path', () => {
    expect(windowsPowerShellExecutable('D:\\Windows')).toBe(
      'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
    expect(windowsPowerShellExecutable(undefined)).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
  })

  it('sends the program as one printable-ASCII line with the request as a quoted literal', () => {
    const input = windowsPowerShellHelperInput(
      "param([string]$RequestJson)\r\n$value = 'it''s'\n[Console]::Out.Write($RequestJson)",
      { path: "C:\\Users\\Jürgen O'Brien\\蜂 🐝", quote: '‘’' },
    )

    expect(input.endsWith('\n')).toBe(true)
    expect(input.slice(0, -1)).toMatch(/^[\x20-\x7e]+$/u)
    expect(input).toContain("'param([string]$RequestJson)','$value = ''it''''s''','[Console]")
    // Typographic quotes and every other non-ASCII character become JSON escapes inside the
    // single-quoted literal, and an ASCII apostrophe is doubled, so the request stays data.
    expect(input).toContain(
      String.raw`'{"path":"C:\\Users\\J\u00fcrgen O''Brien\\\u8702 \ud83d\udc1d","quote":"\u2018\u2019"}'`,
    )
    const literal = /\) '(?<json>(?:[^']|'')*)'\n$/u.exec(input)?.groups?.json ?? ''
    expect(JSON.parse(literal.replaceAll("''", "'"))).toEqual({
      path: "C:\\Users\\Jürgen O'Brien\\蜂 🐝",
      quote: '‘’',
    })
  })

  it('refuses a script that is not printable ASCII instead of letting a code page change it', () => {
    expect(() => windowsPowerShellHelperInput("Write-Output '‘'", {})).toThrow('printable ASCII')
    expect(() => windowsPowerShellHelperInput('\tWrite-Output 1', {})).toThrow('printable ASCII')
  })

  it('reads a helper result without the terminal mode sequences its host may add', () => {
    expect(windowsPowerShellHelperOutput('\u001b[?1h\u001b[?1lS-1-5-21-1\u001b[?1h\r\n')).toBe(
      'S-1-5-21-1',
    )
    expect(windowsPowerShellHelperOutput('noise S-1-5-21-1')).toBe('noise S-1-5-21-1')
  })
})
