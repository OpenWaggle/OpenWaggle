import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectConfigSchema, type qualityTierSchema } from '@shared/schemas/validation'
import { isEnoent } from '@shared/utils/node-error'
import type { z } from 'zod'
import { createLogger } from '../logger'
import type { BaseSamplingConfig } from '../providers/provider-definition'

const CLAMP_OPTIONAL_ARG_3 = 2
const CLAMP_OPTIONAL_ARG_3_VALUE_1_000_000 = 1_000_000
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const PROJECT_CONFIG_FILE_NAME = 'config.toml'
const EMPTY_CONFIG_TOML = ''

const logger = createLogger('project-config')

export interface ProjectQualityOverrides {
  readonly low?: Partial<BaseSamplingConfig>
  readonly medium?: Partial<BaseSamplingConfig>
  readonly high?: Partial<BaseSamplingConfig>
}

export interface ProjectWriteFileApprovalTrust {
  readonly trusted?: boolean
  readonly timestamp?: string
  readonly source?: string
}

export interface ProjectConfig {
  readonly quality?: ProjectQualityOverrides
  readonly approvals?: {
    readonly tools?: {
      readonly writeFile?: ProjectWriteFileApprovalTrust
    }
  }
}

const EMPTY_CONFIG: ProjectConfig = {}
type ParsedProjectConfig = z.infer<typeof projectConfigSchema>

const configCache = new Map<string, { config: ProjectConfig; mtime: number }>()

/** Clear cached configs — useful for tests and after known config edits. */
export function clearConfigCache(): void {
  configCache.clear()
}

function getConfigPath(projectPath: string): string {
  return join(projectPath, OPENWAGGLE_CONFIG_DIR, PROJECT_CONFIG_FILE_NAME)
}

function getConfigTempPath(configPath: string): string {
  return `${configPath}.${randomUUID()}.tmp`
}

function parseValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

async function readValidatedProjectConfig(
  filePath: string,
  options: { strict: boolean },
): Promise<ParsedProjectConfig | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const { parse } = await import('smol-toml')
    const parsedToml: unknown = raw.trim().length > 0 ? parse(raw) : {}
    const validated = projectConfigSchema.safeParse(parsedToml)
    if (!validated.success) {
      const message = `Invalid project config schema: ${parseValidationIssues(validated.error)}`
      if (options.strict) {
        throw new Error(message)
      }
      logger.warn('Failed to validate .openwaggle/config.toml', { message })
      return null
    }
    return validated.data
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    if (options.strict) {
      throw error
    }
    logger.warn('Failed to parse .openwaggle/config.toml', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const filePath = getConfigPath(projectPath)

  try {
    const st = await stat(filePath)
    const cached = configCache.get(filePath)
    if (cached && cached.mtime === st.mtimeMs) {
      return cached.config
    }

    const parsed = await readValidatedProjectConfig(filePath, { strict: false })
    const config = parsed ? parseProjectConfig(parsed) : EMPTY_CONFIG

    configCache.set(filePath, { config, mtime: st.mtimeMs })
    return config
  } catch (error) {
    if (isEnoent(error)) {
      configCache.delete(filePath)
      return EMPTY_CONFIG
    }
    logger.warn('Failed to parse .openwaggle/config.toml', {
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY_CONFIG
  }
}

export async function ensureProjectConfigFile(projectPath: string): Promise<string> {
  const configPath = getConfigPath(projectPath)
  const configDir = join(projectPath, OPENWAGGLE_CONFIG_DIR)

  await mkdir(configDir, { recursive: true })

  try {
    await stat(configPath)
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
    await writeFile(configPath, EMPTY_CONFIG_TOML, 'utf-8')
  }

  return configPath
}

export async function updateProjectConfig(
  projectPath: string,
  updater: (current: ParsedProjectConfig) => ParsedProjectConfig,
): Promise<ProjectConfig> {
  const configPath = await ensureProjectConfigFile(projectPath)
  const current =
    (await readValidatedProjectConfig(configPath, { strict: true })) ??
    projectConfigSchema.parse({})
  const next = projectConfigSchema.parse(updater(current))

  const { stringify } = await import('smol-toml')
  const serialized = stringify(next)
  const tempPath = getConfigTempPath(configPath)

  try {
    await writeFile(tempPath, serialized, 'utf-8')
    await rename(tempPath, configPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }

  configCache.delete(configPath)
  return parseProjectConfig(next)
}

export async function setWriteFileTrust(
  projectPath: string,
  trusted: boolean,
  source: string,
): Promise<ProjectConfig> {
  const timestamp = new Date().toISOString()
  return updateProjectConfig(projectPath, (current) => ({
    ...current,
    approvals: {
      ...current.approvals,
      tools: {
        ...current.approvals?.tools,
        writeFile: {
          ...current.approvals?.tools?.writeFile,
          trusted,
          timestamp,
          source,
        },
      },
    },
  }))
}

function parseProjectConfig(parsed: ParsedProjectConfig): ProjectConfig {
  const quality = parsed.quality
  const writeFileTrust = parsed.approvals?.tools?.writeFile

  const qualityOverrides: ProjectQualityOverrides = {
    low: parseTierOverride(quality?.low),
    medium: parseTierOverride(quality?.medium),
    high: parseTierOverride(quality?.high),
  }

  const hasQuality =
    qualityOverrides.low !== undefined ||
    qualityOverrides.medium !== undefined ||
    qualityOverrides.high !== undefined

  const hasWriteFileTrust =
    writeFileTrust?.trusted !== undefined ||
    writeFileTrust?.timestamp !== undefined ||
    writeFileTrust?.source !== undefined

  if (!hasQuality && !hasWriteFileTrust) {
    return EMPTY_CONFIG
  }

  return {
    ...(hasQuality ? { quality: qualityOverrides } : {}),
    ...(hasWriteFileTrust
      ? {
          approvals: {
            tools: {
              writeFile: {
                trusted: writeFileTrust?.trusted,
                timestamp: writeFileTrust?.timestamp,
                source: writeFileTrust?.source,
              },
            },
          },
        }
      : {}),
  }
}

function clampOptional(value: number, min: number, max: number, name: string): number | undefined {
  if (value >= min && value <= max) return value
  logger.warn(
    `config.toml: ${name} = ${String(value)} is out of range [${String(min)}, ${String(max)}], ignoring`,
  )
  return undefined
}

function parseTierOverride(
  tier: z.infer<typeof qualityTierSchema> | undefined,
): Partial<BaseSamplingConfig> | undefined {
  if (!tier) return undefined

  const out: { temperature?: number; topP?: number; maxTokens?: number } = {}

  if (typeof tier.temperature === 'number') {
    const v = clampOptional(tier.temperature, 0, CLAMP_OPTIONAL_ARG_3, 'temperature')
    if (v !== undefined) out.temperature = v
  }
  if (typeof tier.top_p === 'number') {
    const v = clampOptional(tier.top_p, 0, 1, 'top_p')
    if (v !== undefined) out.topP = v
  }
  if (typeof tier.max_tokens === 'number') {
    const v = clampOptional(tier.max_tokens, 1, CLAMP_OPTIONAL_ARG_3_VALUE_1_000_000, 'max_tokens')
    if (v !== undefined) out.maxTokens = v
  }

  return Object.keys(out).length > 0 ? out : undefined
}
