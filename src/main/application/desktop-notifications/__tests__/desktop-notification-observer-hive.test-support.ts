import {
  AGENT,
  PERSON,
  session,
  settled,
  setup,
} from './desktop-notification-observer.test-harness'

export const person = { originCallerId: PERSON, scheduledTaskPolicy: null }

/** A Queen (`root`) with Workers `w1` and `w2`, and `w3` spawned by `w1`. */
export function hive(overrides: Parameters<typeof setup>[0] = {}) {
  return setup({
    sessions: {
      root: session('root', { title: 'Queen' }),
      w1: session('w1', { parentSessionId: 'root', parentTitle: 'Queen' }),
      w2: session('w2', { parentSessionId: 'root', parentTitle: 'Queen' }),
      w3: session('w3', { parentSessionId: 'w1', parentTitle: 'Title w1' }),
    },
    parents: { w1: 'root', w2: 'root', w3: 'w1' },
    runs: {
      'run-1': person,
      'run-2': person,
      // A Hive wake acts for the caller of the Queen's latest Run: here the person.
      'wake-1': person,
      'wake-2': person,
      'w1-run': { originCallerId: AGENT, scheduledTaskPolicy: null },
      'w2-run': { originCallerId: AGENT, scheduledTaskPolicy: null },
      'w3-run': { originCallerId: AGENT, scheduledTaskPolicy: null },
    },
    ...overrides,
  })
}

export function workerSettled(sessionId: string, status: 'completed' | 'failed' = 'completed') {
  return settled(`${sessionId}-run`, status, { sessionId })
}
