import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { runWithToolContext, type ToolContext } from '../define-tool'
import { listFilesTool } from './list-files'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-listfiles-'))
  tempDirs.push(dir)
  return dir
}

function makeContext(projectPath: string): ToolContext {
  return {
    conversationId: ConversationId('test-conv'),
    projectPath,
    signal: new AbortController().signal,
  }
}

function extractText(result: unknown): string {
  if (typeof result === 'string') return result
  if (typeof result === 'object' && result !== null && 'kind' in result) {
    const r = result as { kind: string; text?: string; data?: unknown }
    if (r.kind === 'text' && typeof r.text === 'string') return r.text
    if (r.kind === 'json') return JSON.stringify(r.data)
  }
  return String(result)
}

async function executeListFiles(
  args: { path?: string; recursive?: boolean },
  ctx: ToolContext,
): Promise<string> {
  // biome-ignore lint/style/noNonNullAssertion: test helper
  const result = await runWithToolContext(ctx, () => listFilesTool.execute!(args))
  return extractText(result)
}

describe('listFilesTool', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists files with sizes in root directory', async () => {
    const dir = makeTempDir()
    await fsp.writeFile(path.join(dir, 'readme.md'), 'hello world')
    await fsp.mkdir(path.join(dir, 'src'))

    const result = await executeListFiles({}, makeContext(dir))
    expect(result).toContain('readme.md')
    expect(result).toContain('src/')
  })

  it('returns empty directory message', async () => {
    const dir = makeTempDir()
    const result = await executeListFiles({}, makeContext(dir))
    expect(result).toBe('(empty directory)')
  })

  it('lists files in a subdirectory', async () => {
    const dir = makeTempDir()
    const subDir = path.join(dir, 'src')
    await fsp.mkdir(subDir)
    await fsp.writeFile(path.join(subDir, 'index.ts'), 'export {}')

    const result = await executeListFiles({ path: 'src' }, makeContext(dir))
    expect(result).toContain('index.ts')
  })

  it('lists files recursively with max depth', async () => {
    const dir = makeTempDir()
    await fsp.mkdir(path.join(dir, 'a', 'b', 'c'), { recursive: true })
    await fsp.writeFile(path.join(dir, 'a', 'file1.ts'), 'x')
    await fsp.writeFile(path.join(dir, 'a', 'b', 'file2.ts'), 'x')
    await fsp.writeFile(path.join(dir, 'a', 'b', 'c', 'file3.ts'), 'x')

    const result = await executeListFiles({ recursive: true }, makeContext(dir))
    expect(result).toContain('file1.ts')
    expect(result).toContain('file2.ts')
    expect(result).toContain('file3.ts')
  })

  it('skips node_modules and .git directories', async () => {
    const dir = makeTempDir()
    await fsp.mkdir(path.join(dir, 'node_modules'))
    await fsp.mkdir(path.join(dir, '.git'))
    await fsp.mkdir(path.join(dir, 'src'))
    await fsp.writeFile(path.join(dir, 'node_modules', 'pkg.json'), '{}')

    const result = await executeListFiles({}, makeContext(dir))
    expect(result).not.toContain('node_modules')
    expect(result).not.toContain('.git')
    expect(result).toContain('src/')
  })

  it('formats file sizes correctly', async () => {
    const dir = makeTempDir()
    await fsp.writeFile(path.join(dir, 'tiny.txt'), 'a') // 1 byte
    await fsp.writeFile(path.join(dir, 'medium.txt'), 'x'.repeat(2048)) // 2KB

    const result = await executeListFiles({}, makeContext(dir))
    expect(result).toMatch(/tiny\.txt \(\d+B\)/)
    expect(result).toMatch(/medium\.txt \(2\.0KB\)/)
  })
})
