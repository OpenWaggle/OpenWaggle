import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { runWithToolContext, type ToolContext } from '../define-tool'
import { globTool } from './glob'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-glob-'))
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

async function executeGlob(
  args: { pattern: string; ignore?: string[] },
  ctx: ToolContext,
): Promise<string> {
  // biome-ignore lint/style/noNonNullAssertion: test helper
  const result = await runWithToolContext(ctx, () => globTool.execute!(args))
  return extractText(result)
}

describe('globTool', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('finds matching files', async () => {
    const dir = makeTempDir()
    await fsp.writeFile(path.join(dir, 'file1.ts'), 'x')
    await fsp.writeFile(path.join(dir, 'file2.ts'), 'x')
    await fsp.writeFile(path.join(dir, 'file3.js'), 'x')

    const result = await executeGlob({ pattern: '**/*.ts' }, makeContext(dir))
    expect(result).toContain('file1.ts')
    expect(result).toContain('file2.ts')
    expect(result).not.toContain('file3.js')
  })

  it('returns no-match message for empty results', async () => {
    const dir = makeTempDir()
    const result = await executeGlob({ pattern: '**/*.xyz' }, makeContext(dir))
    expect(result).toBe('No files found matching the pattern.')
  })

  it('rejects absolute paths', async () => {
    const dir = makeTempDir()
    await expect(executeGlob({ pattern: '/etc/passwd' }, makeContext(dir))).rejects.toThrow(
      'relative to the project root',
    )
  })

  it('rejects parent directory traversal', async () => {
    const dir = makeTempDir()
    await expect(executeGlob({ pattern: '../**/*.ts' }, makeContext(dir))).rejects.toThrow(
      'cannot traverse outside',
    )
  })

  it('respects custom ignore patterns', async () => {
    const dir = makeTempDir()
    const srcDir = path.join(dir, 'src')
    const vendorDir = path.join(dir, 'vendor')
    await fsp.mkdir(srcDir, { recursive: true })
    await fsp.mkdir(vendorDir, { recursive: true })
    await fsp.writeFile(path.join(srcDir, 'app.ts'), 'x')
    await fsp.writeFile(path.join(vendorDir, 'lib.ts'), 'x')

    const result = await executeGlob(
      { pattern: '**/*.ts', ignore: ['vendor/**'] },
      makeContext(dir),
    )
    expect(result).toContain('app.ts')
    expect(result).not.toContain('lib.ts')
  })
})
