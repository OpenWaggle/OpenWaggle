import type { ResolvedActionInvocation } from '@shared/types/action-definitions'
import { describe, expect, it } from 'vitest'
import { resolvedActionCommand } from '../native-action-display'

const invocation: ResolvedActionInvocation = {
  type: 'executable',
  executable: 'pnpm',
  args: ['run', 'test unit'],
  cwd: '/project',
}

describe('copied action commands', () => {
  it('quotes task names while keeping ordinary POSIX commands readable', () => {
    expect(resolvedActionCommand(invocation, 'Linux')).toBe("pnpm run 'test unit'")
  })
  it('uses a PowerShell call operator and literal arguments on Windows', () => {
    expect(
      resolvedActionCommand(
        {
          ...invocation,
          executable: 'C:\\my tools\\pnpm.cmd',
          args: ['run', "test's $(name); next"],
        },
        'Windows NT 10.0',
      ),
    ).toBe("& 'C:\\my tools\\pnpm.cmd' 'run' 'test''s $(name); next'")
  })
  it.each(['\u2018', '\u2019', '\u201a', '\u201b'])(
    'keeps PowerShell smart quote %s inside its literal',
    (quote) => {
      expect(
        resolvedActionCommand(
          { ...invocation, args: [`x${quote}; Write-Output injected; #`] },
          'Windows',
        ),
      ).toBe(`& 'pnpm' 'x${quote}${quote}; Write-Output injected; #'`)
    },
  )
  it('preserves an explicitly authored shell command', () => {
    expect(
      resolvedActionCommand(
        { type: 'command', command: 'echo first && echo second', cwd: '/project' },
        'Windows',
      ),
    ).toBe('echo first && echo second')
  })
})
