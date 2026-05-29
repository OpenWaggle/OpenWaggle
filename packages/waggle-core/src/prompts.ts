import type { WaggleConfig } from './config'
import { getWaggleTurn } from './turn-policy'

const FIRST_TURN_NUMBER = 0
const FIRST_AGENT_INDEX = 0
const SECOND_AGENT_INDEX = 1
const NEXT_AGENT_OFFSET = 1

export interface BuildWaggleTurnPromptInput {
  readonly config: WaggleConfig
  readonly turnNumber: number
  readonly userPrompt: string
}

export function buildWaggleTurnPrompt(input: BuildWaggleTurnPromptInput) {
  const turn = getWaggleTurn(input.config, input.turnNumber)
  const agent = turn.agent
  const otherAgent =
    turn.agentIndex === FIRST_AGENT_INDEX
      ? input.config.agents[SECOND_AGENT_INDEX]
      : input.config.agents[FIRST_AGENT_INDEX]
  const lines = [
    `You are "${agent.label}". ${agent.roleDescription}`,
    '',
    `You are collaborating with "${otherAgent.label}" (${otherAgent.roleDescription}).`,
    `This is turn ${String(input.turnNumber + NEXT_AGENT_OFFSET)} of the collaboration.`,
    '',
    'Guidelines:',
    '- Use tools to inspect real files and project state before making claims.',
    '- Build on previous contributions rather than repeating them.',
    '- If you agree with the other agent, say so explicitly and briefly.',
    '- If you disagree, explain your reasoning with references to actual code.',
    '- Focus on adding new value each turn.',
    '- End your turn with a concise, direct summary of your findings and position.',
  ]

  if (input.turnNumber > FIRST_TURN_NUMBER) {
    lines.push(
      '',
      'Review the session above and continue the collaboration.',
      'If the other agent made claims about the code, verify them by reading relevant files.',
      'Focus on your role and perspective.',
    )
  }

  return `${lines.join('\n')}\n\n---\n\nUser request:\n${input.userPrompt}`
}
