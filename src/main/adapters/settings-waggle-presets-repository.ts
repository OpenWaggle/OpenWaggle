import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { wagglePresetSchema } from '@shared/schemas/waggle'
import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import { DEFAULT_MODEL_REF } from '@shared/types/settings'
import type { WagglePreset } from '@shared/types/waggle'
import { Effect, Layer } from 'effect'
import { app } from 'electron'
import { loadProjectConfig, updateProjectConfig } from '../config/project-config'
import { createLogger } from '../logger'
import { WagglePresetsRepository } from '../ports/waggle-presets-repository'

const JSON_INDENT_SPACES = 2
const MAX_TURNS_SAFETY = 8
const MAX_TURNS_SAFETY_VALUE_10 = 10
const GLOBAL_WAGGLE_PRESETS_FILE = 'waggle-presets.json'

const logger = createLogger('waggle-presets-repository')

const wagglePresetFileSchema = Schema.Struct({
  wagglePresets: Schema.optional(Schema.mutable(Schema.Array(wagglePresetSchema))),
})

const BUILT_IN_PRESETS: readonly WagglePreset[] = [
  {
    id: WagglePresetId('builtin-code-review'),
    name: 'Code Review',
    description: 'Architect reviews implementation, Reviewer verifies correctness and edge cases',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: DEFAULT_MODEL_REF,
          roleDescription:
            'You are a senior software architect. Review the code for design patterns, architecture decisions, and best practices. Suggest structural improvements.',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: DEFAULT_MODEL_REF,
          roleDescription:
            "You are a code reviewer focused on correctness. Check for bugs, edge cases, security issues, and test coverage gaps. Verify the architect's suggestions are practical.",
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: MAX_TURNS_SAFETY },
    },
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: WagglePresetId('builtin-debate'),
    name: 'Debate',
    description: 'Two models argue different perspectives then converge on a solution',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Advocate',
          model: DEFAULT_MODEL_REF,
          roleDescription:
            "You argue for the proposed approach. Present its strengths, defend against criticisms, and show why it's the best path forward.",
          color: 'emerald',
        },
        {
          label: 'Critic',
          model: DEFAULT_MODEL_REF,
          roleDescription:
            'You challenge the proposed approach. Find weaknesses, propose alternatives, and push for the strongest possible solution.',
          color: 'violet',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: MAX_TURNS_SAFETY_VALUE_10 },
    },
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: WagglePresetId('builtin-red-team'),
    name: 'Red Team',
    description: 'Attacker probes for vulnerabilities, Defender patches and hardens',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Attacker',
          model: DEFAULT_MODEL_REF,
          roleDescription:
            'You are a security researcher. Analyze the code for vulnerabilities: injection, auth bypass, data leaks, OWASP top 10. Explain each finding clearly.',
          color: 'amber',
        },
        {
          label: 'Defender',
          model: DEFAULT_MODEL_REF,
          roleDescription:
            'You are a security engineer. For each vulnerability found, implement fixes, add validation, and explain the defense strategy.',
          color: 'blue',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: MAX_TURNS_SAFETY },
    },
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
]

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hydratePreset(raw: unknown): WagglePreset | null {
  const result = safeDecodeUnknown(wagglePresetSchema, raw)
  if (!result.success) {
    return null
  }

  const preset = result.data
  return {
    ...preset,
    id: WagglePresetId(preset.id),
    config: {
      ...preset.config,
      agents: [
        {
          ...preset.config.agents[0],
          model: SupportedModelId(preset.config.agents[0].model),
        },
        {
          ...preset.config.agents[1],
          model: SupportedModelId(preset.config.agents[1].model),
        },
      ],
    },
  }
}

function hydratePresets(rawPresets: readonly unknown[] | undefined): WagglePreset[] {
  if (!rawPresets) {
    return []
  }

  const presets: WagglePreset[] = []
  for (const rawPreset of rawPresets) {
    const preset = hydratePreset(rawPreset)
    if (preset) {
      presets.push(preset)
    }
  }
  return presets
}

function mergePresetLayers(input: {
  readonly projectPresets: readonly WagglePreset[]
  readonly userPresets: readonly WagglePreset[]
  readonly builtInPresets: readonly WagglePreset[]
}): WagglePreset[] {
  const result: WagglePreset[] = []
  const seen = new Set<string>()

  for (const layer of [input.projectPresets, input.userPresets, input.builtInPresets]) {
    for (const preset of layer) {
      const id = String(preset.id)
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      result.push(preset)
    }
  }

  return result
}

function getGlobalPresetsPath(): string {
  return join(app.getPath('userData'), GLOBAL_WAGGLE_PRESETS_FILE)
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return raw.trim().length > 0 ? JSON.parse(raw) : {}
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function readUserPresets(): Promise<WagglePreset[]> {
  const filePath = getGlobalPresetsPath()
  const parsed = await readJsonFile(filePath)
  if (!parsed) {
    return []
  }
  const decoded = safeDecodeUnknown(wagglePresetFileSchema, parsed)
  if (!decoded.success) {
    logger.warn('Failed to parse user Waggle presets file, ignoring invalid presets', {
      filePath,
      issues: decoded.issues,
    })
    return []
  }
  return hydratePresets(decoded.data.wagglePresets)
}

async function writeUserPresets(presets: readonly WagglePreset[]): Promise<void> {
  const filePath = getGlobalPresetsPath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `${JSON.stringify({ wagglePresets: presets }, null, JSON_INDENT_SPACES)}\n`,
    'utf-8',
  )
}

async function readProjectPresets(projectPath?: string | null): Promise<WagglePreset[]> {
  if (!projectPath) {
    return []
  }
  const config = await loadProjectConfig(projectPath)
  return [...(config.wagglePresets ?? [])]
}

async function writeProjectPresets(
  projectPath: string,
  presets: readonly WagglePreset[],
): Promise<void> {
  await updateProjectConfig(projectPath, (current) => ({
    ...current,
    wagglePresets: [...presets],
  }))
}

async function loadScopedPresets(projectPath?: string | null): Promise<{
  readonly presets: readonly WagglePreset[]
  readonly write: (presets: readonly WagglePreset[]) => Promise<void>
}> {
  if (projectPath) {
    return {
      presets: await readProjectPresets(projectPath),
      write: (presets) => writeProjectPresets(projectPath, presets),
    }
  }

  return {
    presets: await readUserPresets(),
    write: writeUserPresets,
  }
}

function normalizeSavedPreset(preset: WagglePreset): WagglePreset {
  const now = Date.now()
  return {
    ...preset,
    id: String(preset.id).trim() ? preset.id : WagglePresetId(randomUUID()),
    isBuiltIn: false,
    createdAt: preset.createdAt > 0 ? preset.createdAt : now,
    updatedAt: now,
  }
}

async function listWagglePresets(projectPath?: string | null): Promise<WagglePreset[]> {
  const [userPresets, projectPresets] = await Promise.all([
    readUserPresets().catch((error) => {
      logger.warn('Failed to read user Waggle presets', { error: describeError(error) })
      return []
    }),
    readProjectPresets(projectPath).catch((error) => {
      logger.warn('Failed to read project Waggle presets', {
        projectPath,
        error: describeError(error),
      })
      return []
    }),
  ])

  return mergePresetLayers({
    projectPresets,
    userPresets,
    builtInPresets: BUILT_IN_PRESETS,
  })
}

async function saveWagglePreset(
  preset: WagglePreset,
  projectPath?: string | null,
): Promise<WagglePreset> {
  const scoped = await loadScopedPresets(projectPath)
  const saved = normalizeSavedPreset(preset)
  const nextPresets = scoped.presets.filter((existing) => existing.id !== saved.id)
  await scoped.write([...nextPresets, saved])
  return saved
}

async function deleteWagglePreset(id: WagglePresetId, projectPath?: string | null): Promise<void> {
  const scoped = await loadScopedPresets(projectPath)
  const nextPresets = scoped.presets.filter((preset) => preset.id !== id)
  await scoped.write(nextPresets)
}

export const SettingsWagglePresetsRepositoryLive = Layer.succeed(
  WagglePresetsRepository,
  WagglePresetsRepository.of({
    list: (projectPath) => Effect.promise(() => listWagglePresets(projectPath)),
    save: (preset, projectPath) => Effect.promise(() => saveWagglePreset(preset, projectPath)),
    delete: (id, projectPath) => Effect.promise(() => deleteWagglePreset(id, projectPath)),
  }),
)
