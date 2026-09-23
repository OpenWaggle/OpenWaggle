import { expect, it } from 'vitest'
import { captureFishExec } from '../preparation-fish-exec'

it('rewrites Fish exec only where it names a command', () => {
  expect(
    captureFishExec(
      'set -gx READY yes; exec /usr/bin/true\nif exec /usr/bin/true\n  echo ready\nend\n',
    ),
  ).toBe(
    'set -gx READY yes; __ow_capture_exec /usr/bin/true\nif __ow_capture_exec /usr/bin/true\n  echo ready\nend\n',
  )
})

it('leaves Fish arguments, quoted text, and comments unchanged', () => {
  const code = 'echo exec \'exec\' "exec" # exec\nset -gx LABEL exec; echo done\n'
  expect(captureFishExec(code)).toBe(code)
})
