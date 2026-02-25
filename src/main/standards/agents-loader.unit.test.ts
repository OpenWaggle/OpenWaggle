import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAgentsInstruction } from './agents-loader'

const tempDirs: string[] = []

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agents-loader-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('loadAgentsInstruction', () => {
  it('returns found when AGENTS.md exists', async () => {
    const projectPath = await makeTempProject()
    const agentsPath = path.join(projectPath, 'AGENTS.md')
    await fs.writeFile(agentsPath, '# rules', 'utf8')

    const result = await loadAgentsInstruction(projectPath)

    expect(result.status).toBe('found')
    expect(result.filePath).toBe(agentsPath)
    expect(result.content).toBe('# rules')
  })

  it('returns missing when AGENTS.md does not exist', async () => {
    const projectPath = await makeTempProject()
    const result = await loadAgentsInstruction(projectPath)

    expect(result.status).toBe('missing')
    expect(result.content).toBeNull()
    expect(result.error).toBeUndefined()
  })

  it('returns missing when project path is null', async () => {
    const result = await loadAgentsInstruction(null)
    expect(result.status).toBe('missing')
  })
})
