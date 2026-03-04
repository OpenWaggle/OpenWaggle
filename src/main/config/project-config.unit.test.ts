import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearConfigCache,
  ensureLocalProjectConfigFile,
  ensureProjectConfigFile,
  loadProjectConfig,
  setWriteFileTrust,
  updateProjectConfig,
} from './project-config'

const SHARED_CONFIG_FILE_NAME = 'config.toml'
const LOCAL_CONFIG_FILE_NAME = 'config.local.toml'
const LOCAL_CONFIG_GIT_EXCLUDE_ENTRY = '.openwaggle/config.local.toml'

function getSharedConfigPath(projectPath: string): string {
  return join(projectPath, '.openwaggle', SHARED_CONFIG_FILE_NAME)
}

function getLocalConfigPath(projectPath: string): string {
  return join(projectPath, '.openwaggle', LOCAL_CONFIG_FILE_NAME)
}

describe('loadProjectConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    clearConfigCache()
    tmpDir = join(tmpdir(), `openwaggle-test-${Date.now()}`)
    mkdirSync(join(tmpDir, '.openwaggle'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses valid TOML with all quality tiers', async () => {
    writeFileSync(
      getSharedConfigPath(tmpDir),
      `
[quality.low]
temperature = 0.2
max_tokens = 1000

[quality.medium]
temperature = 0.5
max_tokens = 3000

[quality.high]
temperature = 0.7
max_tokens = 6000
top_p = 0.8
`,
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.low).toEqual({ temperature: 0.2, maxTokens: 1000 })
    expect(config.quality?.medium).toEqual({ temperature: 0.5, maxTokens: 3000 })
    expect(config.quality?.high).toEqual({ temperature: 0.7, maxTokens: 6000, topP: 0.8 })
  })

  it('returns empty config when file is missing', async () => {
    const config = await loadProjectConfig(join(tmpDir, 'nonexistent'))
    expect(config).toEqual({})
  })

  it('returns empty config when config metadata read fails unexpectedly', async () => {
    const invalidProjectPath = join(tmpDir, 'bad\0path')
    const config = await loadProjectConfig(invalidProjectPath)
    expect(config).toEqual({})
  })

  it('returns empty config for invalid TOML with warning', async () => {
    writeFileSync(getSharedConfigPath(tmpDir), '{{invalid toml}}')
    const config = await loadProjectConfig(tmpDir)
    expect(config).toEqual({})
  })

  it('handles partial overrides — only some tiers present', async () => {
    writeFileSync(
      getSharedConfigPath(tmpDir),
      `
[quality.high]
max_tokens = 8000
`,
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.low).toBeUndefined()
    expect(config.quality?.medium).toBeUndefined()
    expect(config.quality?.high).toEqual({ maxTokens: 8000 })
  })

  it('ignores non-numeric values in tier overrides', async () => {
    writeFileSync(
      getSharedConfigPath(tmpDir),
      `
[quality.medium]
temperature = "not a number"
max_tokens = 3000
`,
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.medium).toEqual({ maxTokens: 3000 })
  })

  it('returns empty config when quality section is absent', async () => {
    writeFileSync(getSharedConfigPath(tmpDir), '[other]\nkey = "value"\n')
    const config = await loadProjectConfig(tmpDir)
    expect(config).toEqual({})
  })

  it('ignores out-of-range values', async () => {
    writeFileSync(
      getSharedConfigPath(tmpDir),
      `
[quality.medium]
temperature = -5
top_p = 1.5
max_tokens = 0
`,
    )

    const config = await loadProjectConfig(tmpDir)
    // All values out of range — tier has no valid overrides
    expect(config.quality?.medium).toBeUndefined()
  })

  it('keeps valid values and ignores invalid ones in the same tier', async () => {
    writeFileSync(
      getSharedConfigPath(tmpDir),
      `
[quality.high]
temperature = 0.8
top_p = -1
max_tokens = 5000
`,
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.high).toEqual({ temperature: 0.8, maxTokens: 5000 })
  })

  it('creates .openwaggle/config.local.toml on first trust write when missing', async () => {
    const isolatedDir = join(tmpDir, 'new-project')
    mkdirSync(isolatedDir, { recursive: true })

    await setWriteFileTrust(isolatedDir, true, 'test')

    const configPath = getLocalConfigPath(isolatedDir)
    expect(existsSync(configPath)).toBe(true)
    const config = await loadProjectConfig(isolatedDir)
    expect(config.approvals?.tools?.writeFile?.trusted).toBe(true)
  })

  it('persists writeFile trust metadata', async () => {
    await setWriteFileTrust(tmpDir, true, 'tool-approval')

    const config = await loadProjectConfig(tmpDir)
    expect(config.approvals?.tools?.writeFile?.trusted).toBe(true)
    expect(config.approvals?.tools?.writeFile?.source).toBe('tool-approval')
    expect(config.approvals?.tools?.writeFile?.timestamp).toBeDefined()
    expect(existsSync(getLocalConfigPath(tmpDir))).toBe(true)
  })

  it('merges shared quality config with local trust config', async () => {
    writeFileSync(
      getSharedConfigPath(tmpDir),
      `
[quality.high]
max_tokens = 9000
`,
      'utf-8',
    )

    await setWriteFileTrust(tmpDir, true, 'tool-approval')

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.high).toEqual({ maxTokens: 9000 })
    expect(config.approvals?.tools?.writeFile?.trusted).toBe(true)
  })

  it('does not mutate shared config.toml when persisting trust', async () => {
    writeFileSync(
      getSharedConfigPath(tmpDir),
      `
[quality.low]
temperature = 0.2
`,
      'utf-8',
    )
    const before = readFileSync(getSharedConfigPath(tmpDir), 'utf-8')

    await setWriteFileTrust(tmpDir, true, 'tool-approval')

    const after = readFileSync(getSharedConfigPath(tmpDir), 'utf-8')
    expect(after).toBe(before)
  })

  it('fails safely on invalid config parsing during update and does not overwrite file', async () => {
    const configPath = getSharedConfigPath(tmpDir)
    writeFileSync(configPath, '{{invalid toml}}', 'utf-8')
    const before = readFileSync(configPath, 'utf-8')

    await expect(
      updateProjectConfig(tmpDir, (current) => ({
        ...current,
        quality: {
          ...current.quality,
          high: {
            ...current.quality?.high,
            max_tokens: 4000,
          },
        },
      })),
    ).rejects.toThrow()

    const after = readFileSync(configPath, 'utf-8')
    expect(after).toBe(before)
  })

  it('ensureProjectConfigFile creates file when missing', async () => {
    const isolatedDir = join(tmpDir, 'ensure-project')
    mkdirSync(isolatedDir, { recursive: true })

    const filePath = await ensureProjectConfigFile(isolatedDir)
    expect(existsSync(filePath)).toBe(true)
  })

  it('ensureLocalProjectConfigFile creates local file when missing', async () => {
    const isolatedDir = join(tmpDir, 'ensure-local-project')
    mkdirSync(isolatedDir, { recursive: true })

    const filePath = await ensureLocalProjectConfigFile(isolatedDir)
    expect(existsSync(filePath)).toBe(true)
    expect(filePath).toBe(getLocalConfigPath(isolatedDir))
  })

  it('adds local config entry to .git/info/exclude and keeps it idempotent', async () => {
    const isolatedDir = join(tmpDir, 'git-project')
    const infoDir = join(isolatedDir, '.git', 'info')
    mkdirSync(infoDir, { recursive: true })
    writeFileSync(join(infoDir, 'exclude'), '# local excludes\n', 'utf-8')

    await setWriteFileTrust(isolatedDir, true, 'tool-approval')
    await setWriteFileTrust(isolatedDir, true, 'tool-approval')

    const exclude = readFileSync(join(infoDir, 'exclude'), 'utf-8')
    const matches = exclude
      .split(/\r?\n/u)
      .filter((line) => line.trim() === LOCAL_CONFIG_GIT_EXCLUDE_ENTRY)
    expect(matches).toHaveLength(1)
  })

  it('adds local config entry to gitdir pointer target excludes', async () => {
    const gitRoot = join(tmpDir, 'parent-repo')
    const worktreeProject = join(tmpDir, 'worktree-project')
    const gitInfoDir = join(gitRoot, '.git', 'info')
    mkdirSync(gitInfoDir, { recursive: true })
    mkdirSync(worktreeProject, { recursive: true })
    writeFileSync(join(worktreeProject, '.git'), 'gitdir: ../parent-repo/.git\n', 'utf-8')

    await setWriteFileTrust(worktreeProject, true, 'tool-approval')

    const exclude = readFileSync(join(gitInfoDir, 'exclude'), 'utf-8')
    expect(exclude).toContain(LOCAL_CONFIG_GIT_EXCLUDE_ENTRY)
  })
})
