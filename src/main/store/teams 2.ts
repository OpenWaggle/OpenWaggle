import { randomUUID } from 'node:crypto'
import { teamPresetSchema } from '@shared/schemas/multi-agent'
import { TeamConfigId } from '@shared/types/brand'
import type { TeamPreset } from '@shared/types/multi-agent'
import Store from 'electron-store'
import { z } from 'zod'
import { createLogger } from '../logger'

const logger = createLogger('teams')

// ── Built-in presets ─────────────────────────────────────────

const BUILT_IN_PRESETS: TeamPreset[] = [
  {
    id: TeamConfigId('builtin-code-review'),
    name: 'Code Review',
    description: 'Architect reviews implementation, Reviewer verifies correctness and edge cases',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: 'claude-sonnet-4-5',
          roleDescription:
            'You are a senior software architect. Review the code for design patterns, architecture decisions, and best practices. Suggest structural improvements.',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: 'claude-sonnet-4-5',
          roleDescription:
            "You are a code reviewer focused on correctness. Check for bugs, edge cases, security issues, and test coverage gaps. Verify the architect's suggestions are practical.",
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 8 },
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
          model: 'claude-sonnet-4-5',
          roleDescription:
            "You argue for the proposed approach. Present its strengths, defend against criticisms, and show why it's the best path forward.",
          color: 'emerald',
        },
        {
          label: 'Critic',
          model: 'claude-sonnet-4-5',
          roleDescription:
            'You challenge the proposed approach. Find weaknesses, propose alternatives, and push for the strongest possible solution.',
          color: 'violet',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 10 },
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
          model: 'claude-sonnet-4-5',
          roleDescription:
            'You are a security researcher. Analyze the code for vulnerabilities: injection, auth bypass, data leaks, OWASP top 10. Explain each finding clearly.',
          color: 'amber',
        },
        {
          label: 'Defender',
          model: 'claude-sonnet-4-5',
          roleDescription:
            'You are a security engineer. For each vulnerability found, implement fixes, add validation, and explain the defense strategy.',
          color: 'blue',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 8 },
    },
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
]

// ── Store ────────────────────────────────────────────────────

interface TeamsStoreData {
  presets: TeamPreset[]
}

const store = new Store<TeamsStoreData>({
  name: 'teams',
  defaults: { presets: [] },
})

function loadUserPresets(): TeamPreset[] {
  const raw: unknown = store.get('presets', [])
  const result = z.array(teamPresetSchema).safeParse(raw)
  if (!result.success) {
    logger.warn('Failed to parse team presets, using empty list')
    return []
  }
  return result.data.map((p) => ({
    ...p,
    id: TeamConfigId(p.id),
  }))
}

export function listTeamPresets(): TeamPreset[] {
  const userPresets = loadUserPresets()
  const userIds = new Set(userPresets.map((p) => p.id))

  // User overrides replace built-ins with the same ID
  const builtIns = BUILT_IN_PRESETS.filter((p) => !userIds.has(p.id))
  return [...builtIns, ...userPresets]
}

export function saveTeamPreset(preset: TeamPreset): TeamPreset {
  const userPresets = loadUserPresets()

  const saved: TeamPreset = {
    ...preset,
    id: preset.id === '' ? TeamConfigId(randomUUID()) : preset.id,
    isBuiltIn: false,
    updatedAt: Date.now(),
    createdAt: preset.createdAt > 0 ? preset.createdAt : Date.now(),
  }

  const existingIndex = userPresets.findIndex((p) => p.id === saved.id)
  if (existingIndex >= 0) {
    userPresets[existingIndex] = saved
  } else {
    userPresets.push(saved)
  }

  store.set('presets', userPresets)
  return saved
}

export function deleteTeamPreset(id: string): void {
  const userPresets = loadUserPresets()
  const filtered = userPresets.filter((p) => p.id !== id)
  store.set('presets', filtered)
}
