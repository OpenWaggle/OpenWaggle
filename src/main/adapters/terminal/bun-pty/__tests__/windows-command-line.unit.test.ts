import { describe, expect, it } from 'vitest'
import {
  quoteWindowsArgument,
  windowsCommandLine,
  windowsEnvironmentBlock,
} from '../windows-command-line'

function decode(units: Uint16Array) {
  return String.fromCharCode(...units)
}

describe('Windows command line', () => {
  it.each([
    ['plain', 'plain'],
    ['', '""'],
    ['two words', '"two words"'],
    ['say "hi"', String.raw`"say \"hi\""`],
    [String.raw`C:\dir with space\\`, String.raw`"C:\dir with space\\\\"`],
    [String.raw`back\"slash`, String.raw`"back\\\"slash"`],
    [String.raw`C:\no\quotes`, String.raw`C:\no\quotes`],
  ])('quotes %j as %j', (argument, quoted) => {
    expect(quoteWindowsArgument(argument)).toBe(quoted)
  })

  it('joins the program and its arguments', () => {
    expect(
      windowsCommandLine(String.raw`C:\Windows\System32\cmd.exe`, ['/d', '/c', 'echo hi']),
    ).toBe(String.raw`C:\Windows\System32\cmd.exe /d /c "echo hi"`)
  })

  it('sorts the environment case-insensitively into a double-NUL block', () => {
    const block = decode(windowsEnvironmentBlock({ path: 'p', ComSpec: 'c', A: '1', '': 'x' }))
    expect(block).toBe('A=1\0ComSpec=c\0path=p\0\0\0')
  })
})
