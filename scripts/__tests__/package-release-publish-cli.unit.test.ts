import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

interface ProcessResult {
  readonly exitCode: number | null
  readonly stderr: string
}

function runNodeScript(scriptPath: string, cwd: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, 'relative.tgz'], { cwd })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (exitCode) => resolve({ exitCode, stderr }))
  })
}

describe('package release publisher CLI', () => {
  it('runs directly on Node 24 from a checkout without node_modules', async () => {
    const emptyDirectory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-publisher-cli-'))
    const scriptPath = path.join(emptyDirectory, 'package-release-publish.ts')
    try {
      await copyFile(path.resolve('scripts/package-release-publish.ts'), scriptPath)
      const result = await runNodeScript(await realpath(scriptPath), emptyDirectory)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Validated tarball path must be an absolute .tgz file.')
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    } finally {
      await rm(emptyDirectory, { recursive: true, force: true })
    }
  })
})
