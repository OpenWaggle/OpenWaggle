import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { enableEscapedExecCapture } from '../preparation-escaped-exec'
import { createPreparationExecutor } from '../preparation-process'

function expressionFor(pattern: string) {
  return String.raw`printf "<%s><%s>\n" $(case x in
${pattern} printf x;;
esac
) \eval`
}

const cases = [
  { shell: '/bin/bash', pattern: '(x)' },
  { shell: '/bin/dash', pattern: 'x)' },
  { shell: '/bin/dash', pattern: '(x)' },
]

describe.skipIf(process.platform === 'win32')('case arm inside command substitution', () => {
  it.each(cases)(
    'keeps an escaped eval as an ordinary argument in static $shell',
    ({ pattern }) => {
      const expression = expressionFor(pattern)
      expect(enableEscapedExecCapture(expression)).toBe(expression)
    },
  )

  it.each(cases.filter(({ shell }) => existsSync(shell)))(
    'keeps the escaped eval argument in static and dynamic $shell Setup with $pattern',
    async ({ shell, pattern }) => {
      const expression = expressionFor(pattern)
      const directory = await mkdtemp(join(tmpdir(), 'ow-case-substitution-'))
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        for (const dynamic of [false, true]) {
          const body = `${expression}
export OW_CASE_SUBSTITUTION=loaded; \\exec /usr/bin/true`
          const command = dynamic ? `code='${body}'; eval "$code"` : body
          const output: string[] = []
          const result = await execute({
            workspace: {
              workspaceId: 'case-substitution',
              projectPath: directory,
              workspacePath: directory,
            },
            invocation: { type: 'command', command, directory: '.' },
            environment: { SHELL: shell },
            captureEnvironment: true,
            onOutput: (chunk) => output.push(chunk),
          })
          expect(result, `${shell} dynamic=${dynamic}`).toMatchObject({
            exitCode: 0,
            environment: { OW_CASE_SUBSTITUTION: 'loaded' },
          })
          expect(output.join(''), `${shell} dynamic=${dynamic}`).toContain('<x><eval>')
        }
      } finally {
        await execute.shutdown()
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
})
