import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { runWithToolContext, type ToolContext } from '../define-tool'
import { writeFileTool } from './write-file'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-writefile-'))
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

function extractData(result: unknown): Record<string, unknown> {
  if (typeof result === 'object' && result !== null && 'kind' in result) {
    const r = result as { kind: string; data?: unknown }
    if (r.kind === 'json' && typeof r.data === 'object' && r.data !== null) {
      return r.data as Record<string, unknown>
    }
  }
  if (typeof result === 'string') return JSON.parse(result) as Record<string, unknown>
  return {}
}

async function executeWriteFile(
  args: { path: string; content: string },
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  // biome-ignore lint/style/noNonNullAssertion: test helper
  const result = await runWithToolContext(ctx, () => writeFileTool.execute!(args))
  return extractData(result)
}

describe('writeFileTool', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates a new file with content', async () => {
    const dir = makeTempDir()
    const parsed = await executeWriteFile(
      { path: 'new-file.txt', content: 'hello' },
      makeContext(dir),
    )
    expect(parsed.message).toContain('new-file.txt')
    expect(parsed.beforeContent).toBe('')
    expect(parsed.afterContent).toBe('hello')

    const written = await fsp.readFile(path.join(dir, 'new-file.txt'), 'utf-8')
    expect(written).toBe('hello')
  })

  it('overwrites existing file and captures before content', async () => {
    const dir = makeTempDir()
    await fsp.writeFile(path.join(dir, 'existing.txt'), 'old content')

    const parsed = await executeWriteFile(
      { path: 'existing.txt', content: 'new content' },
      makeContext(dir),
    )
    expect(parsed.beforeContent).toBe('old content')
    expect(parsed.afterContent).toBe('new content')

    const written = await fsp.readFile(path.join(dir, 'existing.txt'), 'utf-8')
    expect(written).toBe('new content')
  })

  it('creates intermediate directories', async () => {
    const dir = makeTempDir()
    await executeWriteFile({ path: 'deep/nested/dir/file.txt', content: 'deep' }, makeContext(dir))

    const written = await fsp.readFile(path.join(dir, 'deep/nested/dir/file.txt'), 'utf-8')
    expect(written).toBe('deep')
  })

  it('marks needsApproval as true', () => {
    expect(writeFileTool).toHaveProperty('needsApproval')
  })
})
