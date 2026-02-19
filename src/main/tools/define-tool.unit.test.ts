import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectPath } from './define-tool'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('resolveProjectPath', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves paths inside the project root', () => {
    const projectRoot = makeTempDir('openhive-tool-project-')
    const resolved = resolveProjectPath(projectRoot, 'src/main/index.ts')
    expect(resolved).toBe(path.resolve(projectRoot, 'src/main/index.ts'))
  })

  it('rejects traversal outside the project root', () => {
    const projectRoot = makeTempDir('openhive-tool-project-')
    expect(() => resolveProjectPath(projectRoot, '../outside.txt')).toThrow(
      /outside the project directory/i,
    )
  })

  it('rejects symlink escapes when target exists', () => {
    const workspace = makeTempDir('openhive-tool-workspace-')
    const projectRoot = path.join(workspace, 'project')
    const outside = path.join(workspace, 'outside')
    const insideLink = path.join(projectRoot, 'linked')
    const outsideFile = path.join(outside, 'secret.txt')

    fs.mkdirSync(projectRoot, { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(outsideFile, 'classified', 'utf-8')
    fs.symlinkSync(outside, insideLink, 'dir')

    expect(() => resolveProjectPath(projectRoot, 'linked/secret.txt')).toThrow(
      /outside the project directory/i,
    )
  })
})
