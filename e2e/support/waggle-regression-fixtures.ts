import { seedSingleSession } from './session-fixtures'

export const WAGGLE_REGRESSION_THREAD_TITLE = 'Waggle Streaming Regression'
export const WAGGLE_REGRESSION_PROMPT = 'what is the star feature of this app?'

export const WAGGLE_REGRESSION_TURN_LABELS = [
  'Turn 1: Advocate',
  'Turn 2: Critic',
  'Turn 3: Advocate',
  'Turn 4: Critic',
  'Turn 5: Advocate',
] as const

export const WAGGLE_REGRESSION_TURN_CONTENTS = [
  'Advocate turn 1: Waggle mode is the standout feature.',
  'Critic turn 2: The claim is strong, but verify implementation evidence.',
  'Advocate turn 3: Evidence confirms two-agent sequential debate.',
  'Critic turn 4: Distinguish Waggle from generic orchestration behavior.',
  'Advocate turn 5: Final position keeps Waggle as the signature capability.',
] as const

const WAGGLE_REGRESSION_AGENT_METAS = [
  {
    agentIndex: 0,
    agentLabel: 'Advocate',
    agentColor: 'blue',
    agentModel: 'claude-opus-4-6',
    turnNumber: 0,
  },
  {
    agentIndex: 1,
    agentLabel: 'Critic',
    agentColor: 'amber',
    agentModel: 'claude-sonnet-4-6',
    turnNumber: 1,
  },
  {
    agentIndex: 0,
    agentLabel: 'Advocate',
    agentColor: 'blue',
    agentModel: 'claude-opus-4-6',
    turnNumber: 2,
  },
  {
    agentIndex: 1,
    agentLabel: 'Critic',
    agentColor: 'amber',
    agentModel: 'claude-sonnet-4-6',
    turnNumber: 3,
  },
  {
    agentIndex: 0,
    agentLabel: 'Advocate',
    agentColor: 'blue',
    agentModel: 'claude-opus-4-6',
    turnNumber: 4,
  },
] as const

const WAGGLE_REGRESSION_CONFIG = {
  mode: 'sequential',
  agents: [
    {
      label: 'Advocate',
      model: 'claude-opus-4-6',
      roleDescription: 'Argues for the strongest technical case',
      color: 'blue',
    },
    {
      label: 'Critic',
      model: 'claude-sonnet-4-6',
      roleDescription: 'Challenges assumptions and validates evidence',
      color: 'amber',
    },
  ],
  stop: {
    primary: 'consensus',
    maxTurnsSafety: 5,
  },
} as const

export async function makeWaggleRegressionSession(userDataDir: string): Promise<void> {
  const now = Date.now()
  const assistantMessages = WAGGLE_REGRESSION_AGENT_METAS.map((meta, index) => ({
    id: `waggle-assistant-${String(index + 1)}`,
    role: 'assistant' as const,
    model: meta.agentModel,
    metadata: {
      waggle: meta,
    },
    parts: [{ type: 'text' as const, text: WAGGLE_REGRESSION_TURN_CONTENTS[index] }],
    createdAt: now - (WAGGLE_REGRESSION_AGENT_METAS.length - index),
  }))

  await seedSingleSession(userDataDir, {
    title: WAGGLE_REGRESSION_THREAD_TITLE,
    updatedAt: now,
    waggleConfig: WAGGLE_REGRESSION_CONFIG,
    messages: [
      {
        id: 'waggle-user-1',
        role: 'user',
        parts: [{ type: 'text', text: WAGGLE_REGRESSION_PROMPT }],
        createdAt: now - 2,
      },
      ...assistantMessages,
    ],
  })
}
