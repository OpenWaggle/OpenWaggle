import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildEffectiveAgentsInstruction,
  resolveAgentsChainForPath,
  resolveAgentsForRun,
  resolveRootAgents,
} from './agents-resolver'

const tempDirs: string[] = []

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agents-resolver-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('agents-resolver', () => {
  it('loads root AGENTS.md status and content', async () => {
    const projectPath = await makeTempProject()
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root', 'utf8')

    const root = await resolveRootAgents(projectPath)

    expect(root.status).toBe('found')
    expect(root.scopeRelativeDir).toBe('.')
    expect(root.content).toContain('# root')
  })

  it('resolves nested chain from parent to child', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a', 'src'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root', 'utf8')
    await fs.writeFile(path.join(projectPath, 'packages', 'AGENTS.md'), '# packages', 'utf8')
    await fs.writeFile(path.join(projectPath, 'packages', 'a', 'AGENTS.md'), '# package-a', 'utf8')

    const result = await resolveAgentsChainForPath(projectPath, 'packages/a/src/index.ts')

    expect(result.root.status).toBe('found')
    expect(result.scoped.map((scope) => scope.scopeRelativeDir)).toEqual(['packages', 'packages/a'])
    expect(buildEffectiveAgentsInstruction(result)).toContain('# package-a')
  })

  it('rejects paths outside project boundary', async () => {
    const projectPath = await makeTempProject()

    await expect(resolveAgentsChainForPath(projectPath, '../outside.txt')).rejects.toThrow(
      /outside the project directory/i,
    )
  })

  it('dedupes scopes across multiple candidate paths', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a', 'src'), { recursive: true })
    await fs.mkdir(path.join(projectPath, 'packages', 'a', 'tests'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root', 'utf8')
    await fs.writeFile(path.join(projectPath, 'packages', 'AGENTS.md'), '# packages', 'utf8')
    await fs.writeFile(path.join(projectPath, 'packages', 'a', 'AGENTS.md'), '# package-a', 'utf8')

    const result = await resolveAgentsForRun(projectPath, [
      'packages/a/src/index.ts',
      'packages/a/tests/a.test.ts',
    ])

    expect(result.scoped.map((scope) => scope.filePath)).toEqual([
      path.join(projectPath, 'packages', 'AGENTS.md'),
      path.join(projectPath, 'packages', 'a', 'AGENTS.md'),
    ])
  })

  it('returns warnings and continues when one candidate cannot be resolved', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages', 'a'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root', 'utf8')
    await fs.writeFile(path.join(projectPath, 'packages', 'a', 'AGENTS.md'), '# package-a', 'utf8')

    const result = await resolveAgentsForRun(projectPath, ['packages/a/index.ts', '../outside.ts'])

    expect(result.root.status).toBe('found')
    expect(result.scoped.map((scope) => scope.scopeRelativeDir)).toEqual(['packages/a'])
    expect(
      result.warnings.some((warning) => warning.includes('Failed to resolve AGENTS scope')),
    ).toBe(true)
  })

  it('dedupes repeated root-load warnings across multiple candidates', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'AGENTS.md'), { recursive: true })

    const result = await resolveAgentsForRun(projectPath, ['packages/a/src/index.ts', 'packages/b'])
    const rootWarningCount = result.warnings.filter((warning) =>
      warning.startsWith('Failed to load root AGENTS.md:'),
    ).length

    expect(rootWarningCount).toBe(1)
  })
})
