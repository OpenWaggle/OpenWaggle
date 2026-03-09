import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type NormalizedToolResult, resolveProjectPath } from '../define-tool'

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
    const projectRoot = makeTempDir('openwaggle-tool-project-')
    const resolved = resolveProjectPath(projectRoot, 'src/main/index.ts')
    expect(resolved).toBe(path.resolve(projectRoot, 'src/main/index.ts'))
  })

  it('rejects traversal outside the project root', () => {
    const projectRoot = makeTempDir('openwaggle-tool-project-')
    expect(() => resolveProjectPath(projectRoot, '../../outside.txt')).toThrow(
      /outside the project directory/i,
    )
  })

  it('rejects symlink escapes when target exists', () => {
    const workspace = makeTempDir('openwaggle-tool-workspace-')
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

describe('NormalizedToolResult types', () => {
  it('supports explicit text result', () => {
    const result: NormalizedToolResult = { kind: 'text', text: 'hello world' }
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.text).toBe('hello world')
    }
  })

  it('supports explicit json result', () => {
    const result: NormalizedToolResult = { kind: 'json', data: { count: 42 } }
    expect(result.kind).toBe('json')
    if (result.kind === 'json') {
      expect(result.data).toEqual({ count: 42 })
    }
  })

  it('text kind result passes through without JSON reinterpretation', () => {
    // A string "42" wrapped in { kind: 'text' } should NOT become a number
    const result: NormalizedToolResult = { kind: 'text', text: '42' }
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(typeof result.text).toBe('string')
      expect(result.text).toBe('42')
    }
  })
})
