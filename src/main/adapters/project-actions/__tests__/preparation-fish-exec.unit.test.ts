import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { runtimeFishEvalRewriter } from '../preparation-fish-eval-rewriter'
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

it('routes command-position eval through runtime capture without changing quoted code', () => {
  expect(captureFishExec("eval 'set -gx READY yes; exec /usr/bin/true'; builtin eval $code")).toBe(
    "eval (__ow_rewrite_eval 'set -gx READY yes; exec /usr/bin/true' | string collect -N); eval (__ow_rewrite_eval $code | string collect -N)",
  )
})

it.skipIf(process.platform === 'win32')(
  'rewrites evaluated Fish code like the static scanner',
  () => {
    const code =
      'set -gx READY yes; exec /usr/bin/true\n' +
      'echo "exec" # exec\n' +
      'if builtin eval $code; echo ready; end\n'
    const rewritten = execFileSync('awk', [runtimeFishEvalRewriter], {
      input: `${code}\x1c`,
      encoding: 'utf8',
    })
    expect(rewritten).toBe(captureFishExec(code))
  },
)
