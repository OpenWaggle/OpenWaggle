import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { runWithToolContext, type ToolContext } from '../define-tool'
import { readFileTool } from './read-file'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-readfile-'))
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

async function executeReadFile(
  args: { path: string; maxLines?: number },
  ctx: ToolContext,
): Promise<string> {
  // biome-ignore lint/style/noNonNullAssertion: test helper
  const result = await runWithToolContext(ctx, () => readFileTool.execute!(args))
  return extractText(result)
}

describe('readFileTool', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads file contents', async () => {
    const dir = makeTempDir()
    await fsp.writeFile(path.join(dir, 'test.txt'), 'hello world')

    const result = await executeReadFile({ path: 'test.txt' }, makeContext(dir))
    expect(result).toBe('hello world')
  })

  it('truncates to maxLines', async () => {
    const dir = makeTempDir()
    const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')
    await fsp.writeFile(path.join(dir, 'long.txt'), content)

    const result = await executeReadFile({ path: 'long.txt', maxLines: 5 }, makeContext(dir))
    expect(result).toContain('line 1')
    expect(result).toContain('line 5')
    expect(result).toContain('95 more lines')
    expect(result).not.toContain('line 6\n')
  })

  it('returns all lines when maxLines exceeds total lines', async () => {
    const dir = makeTempDir()
    await fsp.writeFile(path.join(dir, 'short.txt'), 'line 1\nline 2\nline 3')

    const result = await executeReadFile({ path: 'short.txt', maxLines: 100 }, makeContext(dir))
    expect(result).toBe('line 1\nline 2\nline 3')
    expect(result).not.toContain('more lines')
  })

  it('throws for non-existent file with helpful message', async () => {
    const dir = makeTempDir()
    await expect(executeReadFile({ path: 'does-not-exist.txt' }, makeContext(dir))).rejects.toThrow(
      /was not found.*Run listFiles/,
    )
  })

  it('throws for directory path', async () => {
    const dir = makeTempDir()
    await fsp.mkdir(path.join(dir, 'subdir'))
    await expect(executeReadFile({ path: 'subdir' }, makeContext(dir))).rejects.toThrow(
      'is a directory',
    )
  })

  it('rejects files larger than 1 MB', async () => {
    const dir = makeTempDir()
    const bigContent = 'x'.repeat(1024 * 1024 + 1)
    await fsp.writeFile(path.join(dir, 'big.bin'), bigContent)

    await expect(executeReadFile({ path: 'big.bin' }, makeContext(dir))).rejects.toThrow(
      /exceeds 1 MB/,
    )
  })
})
