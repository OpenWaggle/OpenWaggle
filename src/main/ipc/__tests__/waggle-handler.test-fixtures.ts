import { SupportedModelId } from '@shared/types/brand'
import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'

export function inheritedFirstAgentConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: 'Plans the implementation',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SupportedModelId('anthropic/claude-sonnet-4-5'),
        roleDescription: 'Reviews the implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  }
}
