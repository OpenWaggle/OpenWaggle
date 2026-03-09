import { randomUUID } from 'node:crypto'
import * as SqlClient from '@effect/sql/SqlClient'
import { safeDecodeUnknown } from '@shared/schema'
import { waggleTeamPresetSchema } from '@shared/schemas/waggle'
import { SupportedModelId, TeamConfigId } from '@shared/types/brand'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { runAppEffect } from '../runtime'

const MAX_TURNS_SAFETY = 8
const MAX_TURNS_SAFETY_VALUE_10 = 10

const logger = createLogger('teams')

interface TeamPresetRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly config_json: string
  readonly is_built_in: number
  readonly created_at: number
  readonly updated_at: number
}

// ── Built-in presets ─────────────────────────────────────────

const BUILT_IN_PRESETS: WaggleTeamPreset[] = [
  {
    id: TeamConfigId('builtin-code-review'),
    name: 'Code Review',
    description: 'Architect reviews implementation, Reviewer verifies correctness and edge cases',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription:
            'You are a senior software architect. Review the code for design patterns, architecture decisions, and best practices. Suggest structural improvements.',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: SupportedModelId('claude-sonnet-4-5'),
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
    id: TeamConfigId('builtin-debate'),
    name: 'Debate',
    description: 'Two models argue different perspectives then converge on a solution',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Advocate',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription:
            "You argue for the proposed approach. Present its strengths, defend against criticisms, and show why it's the best path forward.",
          color: 'emerald',
        },
        {
          label: 'Critic',
          model: SupportedModelId('claude-sonnet-4-5'),
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
    id: TeamConfigId('builtin-red-team'),
    name: 'Red Team',
    description: 'Attacker probes for vulnerabilities, Defender patches and hardens',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Attacker',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription:
            'You are a security researcher. Analyze the code for vulnerabilities: injection, auth bypass, data leaks, OWASP top 10. Explain each finding clearly.',
          color: 'amber',
        },
        {
          label: 'Defender',
          model: SupportedModelId('claude-sonnet-4-5'),
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

let userPresetsCache: WaggleTeamPreset[] = []
let initializationPromise: Promise<void> | null = null
let writeQueue: Promise<void> = Promise.resolve()

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJsonUnknown(raw: string): unknown {
  return JSON.parse(raw)
}

function hydratePreset(raw: unknown): WaggleTeamPreset | null {
  const result = safeDecodeUnknown(waggleTeamPresetSchema, raw)
  if (!result.success) {
    logger.warn('Failed to parse team preset row, skipping invalid entry')
    return null
  }

  const preset = result.data
  return {
    ...preset,
    id: TeamConfigId(preset.id),
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

async function loadUserPresetsFromDb(): Promise<void> {
  const rows = await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<TeamPresetRow>`
        SELECT id, name, description, config_json, is_built_in, created_at, updated_at
        FROM team_presets
        ORDER BY updated_at ASC, id ASC
      `
    }),
  )

  const nextPresets: WaggleTeamPreset[] = []
  for (const row of rows) {
    const preset = hydratePreset({
      id: row.id,
      name: row.name,
      description: row.description,
      config: parseJsonUnknown(row.config_json),
      isBuiltIn: row.is_built_in === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
    if (preset !== null) {
      nextPresets.push(preset)
    }
  }
  userPresetsCache = nextPresets
}

async function writePresetToDb(preset: WaggleTeamPreset): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO team_presets (
          id,
          name,
          description,
          config_json,
          is_built_in,
          created_at,
          updated_at
        )
        VALUES (
          ${preset.id},
          ${preset.name},
          ${preset.description},
          ${JSON.stringify(preset.config)},
          ${0},
          ${preset.createdAt},
          ${preset.updatedAt}
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          config_json = excluded.config_json,
          is_built_in = excluded.is_built_in,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `
    }),
  )
}

async function deletePresetFromDb(id: string): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        DELETE FROM team_presets
        WHERE id = ${id}
      `
    }),
  )
}

function queuePersist(operation: () => Promise<void>): void {
  writeQueue = writeQueue.then(operation).catch((error) => {
    logger.warn('Failed to persist team preset state', {
      error: describeError(error),
    })
  })
}

export async function initializeTeamStore(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = loadUserPresetsFromDb().catch((error) => {
    logger.warn('Failed to initialize team preset cache from SQLite', {
      error: describeError(error),
    })
    userPresetsCache = []
  })

  await initializationPromise
}

export function listTeamPresets(): WaggleTeamPreset[] {
  const userIds = new Set(userPresetsCache.map((preset) => preset.id))
  const builtIns = BUILT_IN_PRESETS.filter((preset) => !userIds.has(preset.id))
  return [...builtIns, ...userPresetsCache]
}

export function saveTeamPreset(preset: WaggleTeamPreset): WaggleTeamPreset {
  const now = Date.now()
  const saved: WaggleTeamPreset = {
    ...preset,
    id: preset.id === '' ? TeamConfigId(randomUUID()) : preset.id,
    isBuiltIn: false,
    updatedAt: now,
    createdAt: preset.createdAt > 0 ? preset.createdAt : now,
  }

  const nextPresets = userPresetsCache.filter((existing) => existing.id !== saved.id)
  nextPresets.push(saved)
  userPresetsCache = nextPresets
  queuePersist(() => writePresetToDb(saved))
  return saved
}

export function deleteTeamPreset(id: string): void {
  userPresetsCache = userPresetsCache.filter((preset) => preset.id !== id)
  queuePersist(() => deletePresetFromDb(id))
}
