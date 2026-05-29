import { WAGGLE_INHERIT_MODEL, type WagglePreset } from './config'

const CREATED_AT_BUILT_IN = 0
const UPDATED_AT_BUILT_IN = 0
const DEFAULT_MAX_TURNS_SAFETY = 8
const DEBATE_MAX_TURNS_SAFETY = 10

export const BUILT_IN_WAGGLE_PRESETS: readonly WagglePreset[] = [
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Architect reviews implementation, Reviewer verifies correctness and edge cases',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription:
            'You are a senior software architect. Review the code for design patterns, architecture decisions, and best practices. Suggest structural improvements.',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription:
            "You are a code reviewer focused on correctness. Check for bugs, edge cases, security issues, and test coverage gaps. Verify the architect's suggestions are practical.",
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: DEFAULT_MAX_TURNS_SAFETY },
    },
    isBuiltIn: true,
    createdAt: CREATED_AT_BUILT_IN,
    updatedAt: UPDATED_AT_BUILT_IN,
  },
  {
    id: 'debate',
    name: 'Debate',
    description: 'Two models argue different perspectives then converge on a solution',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Advocate',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription:
            "You argue for the proposed approach. Present its strengths, defend against criticisms, and show why it's the best path forward.",
          color: 'emerald',
        },
        {
          label: 'Critic',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription:
            'You challenge the proposed approach. Find weaknesses, propose alternatives, and push for the strongest possible solution.',
          color: 'violet',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: DEBATE_MAX_TURNS_SAFETY },
    },
    isBuiltIn: true,
    createdAt: CREATED_AT_BUILT_IN,
    updatedAt: UPDATED_AT_BUILT_IN,
  },
  {
    id: 'red-team',
    name: 'Red Team',
    description: 'Attacker probes for vulnerabilities, Defender patches and hardens',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Attacker',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription:
            'You are a security researcher. Analyze the code for vulnerabilities: injection, auth bypass, data leaks, OWASP top 10. Explain each finding clearly.',
          color: 'amber',
        },
        {
          label: 'Defender',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription:
            'You are a security engineer. For each vulnerability found, implement fixes, add validation, and explain the defense strategy.',
          color: 'blue',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: DEFAULT_MAX_TURNS_SAFETY },
    },
    isBuiltIn: true,
    createdAt: CREATED_AT_BUILT_IN,
    updatedAt: UPDATED_AT_BUILT_IN,
  },
]

export function mergeWagglePresets(input: {
  readonly builtIns?: readonly WagglePreset[]
  readonly globalPresets?: readonly WagglePreset[]
  readonly projectPresets?: readonly WagglePreset[]
}): readonly WagglePreset[] {
  const mergedById = new Map<string, WagglePreset>()

  for (const preset of input.builtIns ?? BUILT_IN_WAGGLE_PRESETS) {
    mergedById.set(preset.id, preset)
  }
  for (const preset of input.globalPresets ?? []) {
    mergedById.set(preset.id, preset)
  }
  for (const preset of input.projectPresets ?? []) {
    mergedById.set(preset.id, preset)
  }

  return [...mergedById.values()]
}
