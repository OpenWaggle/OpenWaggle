import { WagglePresetId } from '@shared/types/brand'
import { DEFAULT_MODEL_REF } from '@shared/types/settings'
import type { WagglePreset } from '@shared/types/waggle'

const DEFAULT_MAX_TURNS_SAFETY = 8
const DEBATE_MAX_TURNS_SAFETY = 10

export const BUILT_IN_WAGGLE_PRESETS: readonly WagglePreset[] = [
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
      stop: { primary: 'consensus', maxTurnsSafety: DEFAULT_MAX_TURNS_SAFETY },
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
      stop: { primary: 'consensus', maxTurnsSafety: DEBATE_MAX_TURNS_SAFETY },
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
      stop: { primary: 'consensus', maxTurnsSafety: DEFAULT_MAX_TURNS_SAFETY },
    },
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
]
