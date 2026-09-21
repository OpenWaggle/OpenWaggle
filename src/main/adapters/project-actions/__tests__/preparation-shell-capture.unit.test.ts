import { describe, expect, it } from 'vitest'
import { preparationCaptureInvocation } from '../preparation-shell-capture'

const invocation = { type: 'command', cwd: '/repo', command: 'source ./setup' } as const

describe('preparation shell selection', () => {
  it.each(['/bin/bash', '/bin/zsh', '/usr/bin/fish'])(
    'preserves the resolved shell %s',
    (shell) => {
      expect(preparationCaptureInvocation(invocation, '/private/env', shell)).toMatchObject({
        format: 'nul',
        invocation: { executable: shell, args: ['-c', expect.stringContaining('source ./setup')] },
      })
    },
  )
  it('uses the selected PowerShell and JSON capture even on a POSIX host', () => {
    expect(preparationCaptureInvocation(invocation, '/private/env', '/opt/pwsh')).toMatchObject({
      format: 'json',
      invocation: { executable: '/opt/pwsh' },
    })
  })
  it('rejects unsupported capture shells before launching user code', () => {
    expect(() => preparationCaptureInvocation(invocation, '/private/env', '/bin/tcsh')).toThrow(
      'Setup environment capture is not supported by the configured shell: /bin/tcsh',
    )
  })
})
