/**
 * The old MCP client kept a per-Session switch in `state.json` (`sessionStates`: 'on', 'off' or
 * 'inherit'). Every Session is now on unless switched off in the Host database, so only 'off'
 * carries over, written once per Session through the injected sink. A failed write is logged and
 * tried again on the next start.
 */
import type { Logger } from '@shared/types/logger'
import type { LegacyStateFile } from './legacy-state'
import type { McpMigrationRecord } from './migration-record'

/** Switches MCP off for one Session in the Host's Session state. */
export type McpSessionSwitchMigrationSink = (sessionId: string) => Promise<void>

interface SessionSwitchMigrationInput {
  readonly state: LegacyStateFile
  readonly record: McpMigrationRecord
  readonly sink: McpSessionSwitchMigrationSink | undefined
  readonly now: () => Date
  readonly logger: Logger
}

/** Returns how many old Session states were not carried over. */
export async function migrateLegacySessionSwitches(input: SessionSwitchMigrationInput) {
  const states = Object.entries(input.state.sessionStates)
  const off = states.filter(([, value]) => value === 'off').length
  const { sink } = input
  if (!sink) return states.length
  let carried = 0
  for (const [sessionId, value] of states) {
    if (value !== 'off') continue
    if (input.record.isSessionSwitchHandled(sessionId)) {
      carried += 1
      continue
    }
    try {
      await sink(sessionId)
      await input.record.recordSessionSwitch(sessionId, { migratedAt: input.now().toISOString() })
      carried += 1
    } catch (error) {
      input.logger.error('Could not carry an MCP-off Session switch over', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (carried === off) await input.record.recordSessionSwitchesDone()
  return states.length - carried
}

/**
 * Notes, before anything else is recorded, that the old state has no MCP-off Session switch to
 * carry over, so the note is saved with the run's first record write.
 */
export async function noteNoSessionSwitches(state: LegacyStateFile, record: McpMigrationRecord) {
  const off = Object.values(state.sessionStates).filter((value) => value === 'off')
  if (off.length === 0) await record.recordSessionSwitchesDone()
}
