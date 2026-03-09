import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { executeToolWithContext, type ToolContext } from '../../define-tool'
import { editFileTool } from '../edit-file'

const tempDirs: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-edit-success-'))
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

async function executeEdit(
  args: { path: string; oldString: string; newString: string },
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const result = await executeToolWithContext(editFileTool, ctx, args)
  return extractData(result)
}

describe('editFileTool success path', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('replaces a unique string and returns before/after content', async () => {
    const dir = makeTempDir()
    await fsp.writeFile(path.join(dir, 'app.ts'), 'const x = 1;\nconst y = 2;\n')

    const parsed = await executeEdit(
      { path: 'app.ts', oldString: 'const x = 1;', newString: 'const x = 42;' },
      makeContext(dir),
    )

    expect(parsed.message).toContain('app.ts')
    expect(parsed.beforeContent).toBe('const x = 1;\nconst y = 2;\n')
    expect(parsed.afterContent).toBe('const x = 42;\nconst y = 2;\n')

    const written = await fsp.readFile(path.join(dir, 'app.ts'), 'utf-8')
    expect(written).toBe('const x = 42;\nconst y = 2;\n')
  })

  it('handles multiline old/new strings', async () => {
    const dir = makeTempDir()
    const original = 'function greet() {\n  return "hello";\n}\n'
    await fsp.writeFile(path.join(dir, 'fn.ts'), original)

    const parsed = await executeEdit(
      {
        path: 'fn.ts',
        oldString: '  return "hello";',
        newString: '  return "world";',
      },
      makeContext(dir),
    )

    expect(parsed.afterContent).toContain('return "world"')
  })

  it('omits inline before/after content for large edits', async () => {
    const dir = makeTempDir()
    const original = `const large = "${'a'.repeat(3000)}";\n`
    await fsp.writeFile(path.join(dir, 'large.ts'), original)

    const parsed = await executeEdit(
      {
        path: 'large.ts',
        oldString: 'a'.repeat(3000),
        newString: 'b'.repeat(3000),
      },
      makeContext(dir),
    )

    expect(parsed.message).toBe('File edited: large.ts')
    expect(parsed.largeContentOmitted).toBe(true)
    expect(parsed.beforeContent).toBeUndefined()
    expect(parsed.afterContent).toBeUndefined()
    expect(parsed.beforeSizeBytes).toBeGreaterThan(3000)
    expect(parsed.afterSizeBytes).toBeGreaterThan(3000)
  })
})
