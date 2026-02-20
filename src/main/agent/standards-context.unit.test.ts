import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAgentStandardsContext } from './standards-context'

const tempDirs: string[] = []

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openhive-standards-context-'))
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
    await fs.mkdir(path.join(projectPath, '.openhive'), { recursive: true })
    await fs.writeFile(path.join(projectPath, '.openhive', 'skills'), 'not-a-directory', 'utf8')

    const context = await loadAgentStandardsContext(projectPath, 'hello', {
      ...DEFAULT_SETTINGS,
      providers: {
        ...DEFAULT_SETTINGS.providers,
      },
    })

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
})
