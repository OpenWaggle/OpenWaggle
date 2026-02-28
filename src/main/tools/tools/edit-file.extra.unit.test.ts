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
  if (typeof result === 'object' && result !== null && 'kind' in result) {
    const r = result as { kind: string; data?: unknown }
    if (r.kind === 'json' && typeof r.data === 'object' && r.data !== null) {
      return r.data as Record<string, unknown>
    }
  }
  if (typeof result === 'string') return JSON.parse(result) as Record<string, unknown>
  return {}
}

async function executeEdit(
  args: { path: string; oldString: string; newString: string },
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  // biome-ignore lint/style/noNonNullAssertion: test helper
  const result = await runWithToolContext(ctx, () => editFileTool.execute!(args))
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
})
