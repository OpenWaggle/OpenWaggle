import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAgentStandardsContext } from '../standards-context'

const tempDirs: string[] = []

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-standards-context-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('loadAgentStandardsContext', () => {
  it('continues gracefully when skills catalog read fails', async () => {
    const projectPath = await makeTempProject()
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# Rules', 'utf8')
    await fs.mkdir(path.join(projectPath, '.openwaggle'), { recursive: true })
    await fs.writeFile(path.join(projectPath, '.openwaggle', 'skills'), 'not-a-directory', 'utf8')

    const context = await loadAgentStandardsContext(projectPath, 'hello', DEFAULT_SETTINGS)

    expect(context.agentsStatus).toBe('found')
    expect(context.activeSkills).toEqual([])
    expect(
      context.warnings.some((warning) => warning.includes('Failed to load skills catalog')),
    ).toBe(true)
  })

  it('returns empty context when project is missing', async () => {
    const context = await loadAgentStandardsContext(null, 'hello', DEFAULT_SETTINGS)
    expect(context.agentsStatus).toBe('missing')
    expect(context.activeSkills).toEqual([])
  })

  it('loads inferred nested AGENTS scope from user path', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a', 'src'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root rules', 'utf8')
    await fs.writeFile(
      path.join(projectPath, 'packages', 'a', 'AGENTS.md'),
      '# package-a rules',
      'utf8',
    )

    const context = await loadAgentStandardsContext(
      projectPath,
      'Please edit packages/a/src/index.ts',
      DEFAULT_SETTINGS,
    )

    expect(context.agentsRootInstruction).toContain('# root rules')
    expect(context.agentsScopedInstructions.map((scope) => scope.scopeRelativeDir)).toEqual([
      'packages/a',
    ])
    expect(context.agentsResolvedFiles).toContain(path.join(projectPath, 'AGENTS.md'))
    expect(context.agentsResolvedFiles).toContain(
      path.join(projectPath, 'packages', 'a', 'AGENTS.md'),
    )
  })

  it('does not inject unrelated nested AGENTS scopes', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a', 'src'), { recursive: true })
    await fs.mkdir(path.join(projectPath, 'packages', 'b', 'src'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root rules', 'utf8')
    await fs.writeFile(
      path.join(projectPath, 'packages', 'a', 'AGENTS.md'),
      '# package-a rules',
      'utf8',
    )
    await fs.writeFile(
      path.join(projectPath, 'packages', 'b', 'AGENTS.md'),
      '# package-b rules',
      'utf8',
    )

    const context = await loadAgentStandardsContext(
      projectPath,
      'Please edit packages/a/src/index.ts',
      DEFAULT_SETTINGS,
    )

    expect(context.agentsScopedInstructions.map((scope) => scope.scopeRelativeDir)).toEqual([
      'packages/a',
    ])
  })

  it('ignores temp attachments outside project when resolving AGENTS scopes', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a', 'src'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root rules', 'utf8')
    await fs.writeFile(
      path.join(projectPath, 'packages', 'a', 'AGENTS.md'),
      '# package-a rules',
      'utf8',
    )

    const outsideAttachment: PreparedAttachment = {
      id: 'outside-attachment',
      kind: 'text',
      name: 'prompt-123.md',
      path: path.join(os.tmpdir(), 'openwaggle-temp-attachments', 'prompt-123.md'),
      mimeType: 'text/markdown',
      sizeBytes: 10,
      extractedText: 'hello',
    }

    const context = await loadAgentStandardsContext(
      projectPath,
      'Please edit packages/a/src/index.ts',
      DEFAULT_SETTINGS,
      [outsideAttachment],
    )

    expect(context.agentsScopedInstructions.map((scope) => scope.scopeRelativeDir)).toEqual([
      'packages/a',
    ])
    expect(
      context.warnings.some((warning) => warning.includes('Failed to resolve AGENTS scope')),
    ).toBe(false)
  })
})
