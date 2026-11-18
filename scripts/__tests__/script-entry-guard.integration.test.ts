import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BUNDLE_TIMEOUT_MS = 60_000

function run(command: string, args: readonly string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd() })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

// Regression: the scripts compared `import.meta.url` with `file://${argv[1]}`, which never matches
// a path with a space (the URL encodes it as %20) or a Windows path, so the commit-msg hook passed
// every message without checking it.
describe('script entry guards', () => {
  let directory = ''

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle entry guard '))
    await Promise.all(
      ['check-conventional-commits', 'release-ci-policy'].map((name) =>
        run('bun', [
          'build',
          `scripts/${name}.ts`,
          '--target',
          'bun',
          '--outfile',
          path.join(directory, `${name}.js`),
        ]),
      ),
    )
  }, BUNDLE_TIMEOUT_MS)

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('checks a commit message when the hook runs from a path with a space', async () => {
    const messageFile = path.join(directory, 'COMMIT_EDITMSG')
    await fs.writeFile(messageFile, 'not a conventional subject\n')

    const result = await run('bun', [
      path.join(directory, 'check-conventional-commits.js'),
      '--message-file',
      messageFile,
    ])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('commit-msg:')
  })

  it('runs the release CI policy from a path with a space', async () => {
    const result = await run('bun', [path.join(directory, 'release-ci-policy.js')])

    expect(result).toMatchObject({ code: 0, stdout: 'Release CI policy passed.\n' })
  })
})
