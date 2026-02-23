import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolContext } from '../define-tool'
import { loadAgentsForRun } from './load-agents'

const tempDirs: string[] = []

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openhive-load-agents-tool-'))
  tempDirs.push(dir)
  return dir
}

function makeContext(
  projectPath: string,
  overrides?: {
    loadedScopeFiles?: Set<string>
    loadedRequestedPaths?: Set<string>
  },
): ToolContext {
  return {
    conversationId: ConversationId('conv-load-agents-tool'),
    projectPath,
    dynamicAgents: {
      loadedScopeFiles: overrides?.loadedScopeFiles ?? new Set<string>(),
      loadedRequestedPaths: overrides?.loadedRequestedPaths ?? new Set<string>(),
    },
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('loadAgentsForRun', () => {
  it('returns effective chain for a valid nested path', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a', 'src'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root', 'utf8')
    await fs.writeFile(path.join(projectPath, 'packages', 'a', 'AGENTS.md'), '# package-a', 'utf8')

    const result = await loadAgentsForRun(makeContext(projectPath), 'packages/a/src/index.ts')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolution.root.status).toBe('found')
      expect(result.resolution.scoped.map((scope) => scope.scopeRelativeDir)).toEqual([
        'packages/a',
      ])
      expect(result.effectiveInstruction).toContain('# package-a')
    }
  })

  it('marks repeated loads as alreadyLoaded', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root', 'utf8')
    await fs.writeFile(path.join(projectPath, 'packages', 'a', 'AGENTS.md'), '# package-a', 'utf8')

    const loadedScopeFiles = new Set<string>()
    const context = makeContext(projectPath, { loadedScopeFiles })

    const first = await loadAgentsForRun(context, 'packages/a/index.ts')
    const second = await loadAgentsForRun(context, 'packages/a/index.ts')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.alreadyLoaded).toBe(true)
    }
  })

  it('returns structured error for invalid path traversal', async () => {
    const projectPath = await makeTempProject()

    const result = await loadAgentsForRun(makeContext(projectPath), '../outside.txt')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('outside the project directory')
    }
  })

  it('returns root-only resolution when nested scopes are missing', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root', 'utf8')

    const result = await loadAgentsForRun(makeContext(projectPath), 'packages/a/index.ts')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolution.root.status).toBe('found')
      expect(result.resolution.scoped).toEqual([])
    }
  })
})
