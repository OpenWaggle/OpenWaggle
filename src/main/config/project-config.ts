import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectConfigSchema, type qualityTierSchema } from '@shared/schemas/validation'
import { isEnoent } from '@shared/utils/node-error'
import type { z } from 'zod'
import { createLogger } from '../logger'
import type { BaseSamplingConfig } from '../providers/provider-definition'

const logger = createLogger('project-config')

export interface ProjectQualityOverrides {
  readonly low?: Partial<BaseSamplingConfig>
  readonly medium?: Partial<BaseSamplingConfig>
  readonly high?: Partial<BaseSamplingConfig>
}

export interface ProjectConfig {
  readonly quality?: ProjectQualityOverrides
}

const EMPTY_CONFIG: ProjectConfig = {}

const configCache = new Map<string, { config: ProjectConfig; mtime: number }>()

/** Clear cached configs — useful for tests and after known config edits. */
export function clearConfigCache(): void {
  configCache.clear()
}

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const filePath = join(projectPath, '.openhive', 'config.toml')

  try {
    const stat = statSync(filePath)
    const cached = configCache.get(filePath)
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.config
    }

    const raw = await readFile(filePath, 'utf-8')
    const { parse } = await import('smol-toml')
    const tomlData: unknown = parse(raw)
    const validated = projectConfigSchema.safeParse(tomlData)
    const config = validated.success ? parseProjectConfig(validated.data) : EMPTY_CONFIG

    configCache.set(filePath, { config, mtime: stat.mtimeMs })
    return config
  } catch (error) {
    if (isEnoent(error)) {
      configCache.delete(filePath)
      return EMPTY_CONFIG
    }
    logger.warn('Failed to parse .openhive/config.toml', {
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY_CONFIG
  }
}

function parseProjectConfig(parsed: z.infer<typeof projectConfigSchema>): ProjectConfig {
  const quality = parsed.quality
  if (!quality) {
    return EMPTY_CONFIG
  }

  const overrides: ProjectQualityOverrides = {
    low: parseTierOverride(quality.low),
    medium: parseTierOverride(quality.medium),
    high: parseTierOverride(quality.high),
  }

  return { quality: overrides }
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
    const v = clampOptional(tier.temperature, 0, 2, 'temperature')
    if (v !== undefined) out.temperature = v
  }
  if (typeof tier.top_p === 'number') {
    const v = clampOptional(tier.top_p, 0, 1, 'top_p')
    if (v !== undefined) out.topP = v
  }
  if (typeof tier.max_tokens === 'number') {
    const v = clampOptional(tier.max_tokens, 1, 1_000_000, 'max_tokens')
    if (v !== undefined) out.maxTokens = v
  }

  return Object.keys(out).length > 0 ? out : undefined
}
