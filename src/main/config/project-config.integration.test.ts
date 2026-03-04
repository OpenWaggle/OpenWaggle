import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearConfigCache, loadProjectConfig, setWriteFileTrust } from './project-config'

const LOCAL_CONFIG_GIT_EXCLUDE_ENTRY = '.openwaggle/config.local.toml'

function localConfigPath(projectPath: string): string {
  return join(projectPath, '.openwaggle', 'config.local.toml')
}

function sharedConfigPath(projectPath: string): string {
  return join(projectPath, '.openwaggle', 'config.toml')
}

describe('project config integration', () => {
  let tmpRoot: string

  beforeEach(() => {
    clearConfigCache()
    tmpRoot = join(tmpdir(), `openwaggle-project-config-integration-${Date.now()}`)
    mkdirSync(tmpRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('first trust write creates local config and updates local git exclude', async () => {
    const projectPath = join(tmpRoot, 'project')
    const infoDir = join(projectPath, '.git', 'info')
    mkdirSync(infoDir, { recursive: true })

    await setWriteFileTrust(projectPath, true, 'integration-test')

    const localConfig = readFileSync(localConfigPath(projectPath), 'utf-8')
    const exclude = readFileSync(join(infoDir, 'exclude'), 'utf-8')

    expect(localConfig).toContain('trusted = true')
    expect(exclude).toContain(LOCAL_CONFIG_GIT_EXCLUDE_ENTRY)
  })

  it('repeat trust writes keep a single git exclude entry', async () => {
    const projectPath = join(tmpRoot, 'project-repeat')
    const infoDir = join(projectPath, '.git', 'info')
    mkdirSync(infoDir, { recursive: true })

    await setWriteFileTrust(projectPath, true, 'integration-test')
    await setWriteFileTrust(projectPath, true, 'integration-test')

    const exclude = readFileSync(join(infoDir, 'exclude'), 'utf-8')
    const matches = exclude
      .split(/\r?\n/u)
      .filter((line) => line.trim() === LOCAL_CONFIG_GIT_EXCLUDE_ENTRY)

    expect(matches).toHaveLength(1)
  })

  it('loads merged shared quality and local trust config', async () => {
    const projectPath = join(tmpRoot, 'project-merged')
    mkdirSync(join(projectPath, '.openwaggle'), { recursive: true })
    writeFileSync(
      sharedConfigPath(projectPath),
      `
[quality.high]
max_tokens = 7777
`,
      'utf-8',
    )

    await setWriteFileTrust(projectPath, true, 'integration-test')

    const config = await loadProjectConfig(projectPath)
    expect(config.quality?.high).toEqual({ maxTokens: 7777 })
    expect(config.approvals?.tools?.writeFile?.trusted).toBe(true)
  })
})
