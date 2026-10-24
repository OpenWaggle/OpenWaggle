import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveAgentsChainForPath,
  resolveProjectRootAgents,
  resolveRootAgents,
} from '../agents-resolver'

const tempDirs: string[] = []

async function makeTempProject() {
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
    expect(result.scoped.at(-1)?.content).toContain('# package-a')
  })

  it('rejects paths outside project boundary', async () => {
    const projectPath = await makeTempProject()

    await expect(resolveAgentsChainForPath(projectPath, '../../outside.txt')).rejects.toThrow(
      /outside the project directory/i,
    )
  })

  it('resolves only the root AGENTS.md for the project view', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'packages'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), '# root', 'utf8')
    await fs.writeFile(path.join(projectPath, 'packages', 'AGENTS.md'), '# packages', 'utf8')

    const result = await resolveProjectRootAgents(projectPath)

    expect(result.root.status).toBe('found')
    expect(result.scoped).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('reports a root AGENTS.md that cannot be read', async () => {
    const projectPath = await makeTempProject()
    await fs.mkdir(path.join(projectPath, 'AGENTS.md'), { recursive: true })

    const result = await resolveProjectRootAgents(projectPath)

    expect(result.root.status).toBe('error')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/^Failed to load root AGENTS\.md:/)
  })
})
