import { afterEach, describe, expect, it } from 'vitest'
import { createPiRuntimeServices } from '../pi-provider-catalog'
import { createTempProject, fs, path, writeJson } from './pi-provider-catalog.test-utils'

const tempProjects: string[] = []

afterEach(async () => {
  await Promise.all(
    tempProjects
      .splice(0)
      .map((projectPath) => fs.rm(projectPath, { recursive: true, force: true })),
  )
})

async function tempProject() {
  const projectPath = await createTempProject()
  tempProjects.push(projectPath)
  return projectPath
}

describe('Pi provider catalog compaction metadata', () => {
  it('uses the OpenWaggle global threshold instead of a project override', async () => {
    const projectPath = await tempProject()
    await writeJson(path.join(projectPath, '.openwaggle', 'settings.json'), {
      pi: { compaction: { thresholdPercent: 95 } },
    })

    const services = await createPiRuntimeServices(projectPath, {
      compactionThresholdPercent: 72,
    })

    expect(services.settingsManager.getCompactionSettings().thresholdPercent).toBe(72)
  })

  it('publishes Native compaction only for explicitly capable built-in transports', async () => {
    const services = await createPiRuntimeServices(await tempProject())

    expect(services.modelRuntime.getModel('openai', 'gpt-5.2')?.compat).toMatchObject({
      supportsCompaction: true,
    })
    expect(services.modelRuntime.getModel('openai', 'gpt-5.1')?.compat).not.toEqual(
      expect.objectContaining({ supportsCompaction: true }),
    )
    expect(services.modelRuntime.getModel('openai-codex', 'gpt-5.6-sol')?.compat).toMatchObject({
      supportsCompaction: true,
      compactionBaseUrl: 'https://chatgpt.com/backend-api/codex',
    })
  })
})
