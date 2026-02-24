import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { runWithToolContext, type ToolContext } from '../define-tool'
import { editFileTool } from './edit-file'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhive-edit-'))
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

async function executeEditTool(
  args: { path: string; oldString: string; newString: string },
  ctx: ToolContext,
): Promise<unknown> {
  // biome-ignore lint/style/noNonNullAssertion: test helper — execute is always defined on our tools
  return runWithToolContext(ctx, () => editFileTool.execute!(args))
}

describe('editFileTool error messages', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('includes line count and preview in not-found error', async () => {
    const dir = makeTempDir()
    const filePath = path.join(dir, 'test.ts')
    await fsp.writeFile(filePath, 'line 1\nline 2\nline 3\nline 4\nline 5\n')

    const ctx = makeContext(dir)
    await expect(
      executeEditTool({ path: 'test.ts', oldString: 'nonexistent string', newString: 'x' }, ctx),
    ).rejects.toThrow(/\d+ lines.*Searched for: "nonexistent string"/)
  })

  it('truncates preview to 100 chars for long oldString', async () => {
    const dir = makeTempDir()
    const filePath = path.join(dir, 'test.ts')
    await fsp.writeFile(filePath, 'short content\n')

    const longString = 'a'.repeat(150)
    const ctx = makeContext(dir)
    try {
      await executeEditTool({ path: 'test.ts', oldString: longString, newString: 'x' }, ctx)
      expect.fail('should have thrown')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('a'.repeat(100))
      expect(msg).toContain('...')
      expect(msg).not.toContain('a'.repeat(150))
    }
  })

  it('multiple-match error is unchanged', async () => {
    const dir = makeTempDir()
    const filePath = path.join(dir, 'test.ts')
    await fsp.writeFile(filePath, 'foo\nfoo\nbar\n')

    const ctx = makeContext(dir)
    await expect(
      executeEditTool({ path: 'test.ts', oldString: 'foo', newString: 'baz' }, ctx),
    ).rejects.toThrow(/found 2 times/)
  })
})
