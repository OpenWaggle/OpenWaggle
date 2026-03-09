import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { executeToolWithContext, type ToolContext } from '../../define-tool'
import { writeFileTool } from '../write-file'

const tempDirs: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

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
  if (
    isRecord(result) &&
    'kind' in result &&
    result.kind === 'json' &&
    'data' in result &&
    isRecord(result.data)
  ) {
    return result.data
  }
  if (typeof result === 'string') {
    const parsed: unknown = JSON.parse(result)
    if (isRecord(parsed)) {
      return parsed
    }
  }
  return {}
}

async function executeWriteFile(
  args: { path: string; content?: string; attachmentName?: string },
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const result = await executeToolWithContext(writeFileTool, ctx, args)
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

  it('writes content from the only attachment when content is omitted', async () => {
    const dir = makeTempDir()
    const context: ToolContext = {
      ...makeContext(dir),
      attachments: [{ name: 'Pasted Text 1.md', extractedText: 'from attachment' }],
    }

    const parsed = await executeWriteFile({ path: 'attachment-output.txt' }, context)
    expect(parsed.afterContent).toBe('from attachment')

    const written = await fsp.readFile(path.join(dir, 'attachment-output.txt'), 'utf-8')
    expect(written).toBe('from attachment')
  })

  it('writes content from a named attachment when multiple attachments exist', async () => {
    const dir = makeTempDir()
    const context: ToolContext = {
      ...makeContext(dir),
      attachments: [
        { name: 'A.md', extractedText: 'aaa' },
        { name: 'B.md', extractedText: 'bbb' },
      ],
    }

    const parsed = await executeWriteFile(
      { path: 'selected-output.txt', attachmentName: 'B.md' },
      context,
    )
    expect(parsed.afterContent).toBe('bbb')

    const written = await fsp.readFile(path.join(dir, 'selected-output.txt'), 'utf-8')
    expect(written).toBe('bbb')
  })

  it('omits inline before/after content for large file writes', async () => {
    const dir = makeTempDir()
    const largeContent = 'x'.repeat(5000)

    const parsed = await executeWriteFile(
      { path: 'large-output.txt', content: largeContent },
      makeContext(dir),
    )

    expect(parsed.message).toBe('File written: large-output.txt')
    expect(parsed.largeContentOmitted).toBe(true)
    expect(parsed.beforeContent).toBeUndefined()
    expect(parsed.afterContent).toBeUndefined()
    expect(parsed.beforeSizeBytes).toBe(0)
    expect(parsed.afterSizeBytes).toBe(5000)
  })

  it('throws when multiple attachments exist but no attachmentName is provided', async () => {
    const dir = makeTempDir()
    const context: ToolContext = {
      ...makeContext(dir),
      attachments: [
        { name: 'A.md', extractedText: 'aaa' },
        { name: 'B.md', extractedText: 'bbb' },
      ],
    }

    await expect(executeWriteFile({ path: 'ambiguous-output.txt' }, context)).rejects.toThrow(
      'Multiple attachments are available. Provide attachmentName when calling writeFile without content.',
    )
  })
})
