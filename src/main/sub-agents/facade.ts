/**
 * Facade re-exports for the tool layer.
 * Tool files import from here instead of reaching into individual sub-agent modules.
 * This avoids lazy `await import(...)` in most tools.
 */

import type { SubAgentResult } from '@shared/types/sub-agent'
import type { RunSubAgentParams } from './sub-agent-runner'

// ── Late-binding for runSubAgent (breaks spawn-agent ↔ sub-agent-runner cycle) ──

type RunSubAgentFn = (params: RunSubAgentParams) => Promise<SubAgentResult>

let _runSubAgent: RunSubAgentFn | null = null

export function registerRunSubAgent(fn: RunSubAgentFn): void {
  _runSubAgent = fn
}

export function getRunSubAgent(): RunSubAgentFn {
  if (!_runSubAgent) {
    throw new Error('runSubAgent not registered — call registerRunSubAgent() at startup')
  }
  return _runSubAgent
}

export {
  handleShutdownResponse,
  loadPendingMessages,
  persistPendingMessages,
  sendAgentMessage,
} from './message-bus'
export type { UpdateTaskResult } from './task-board'
export {
  createTask,
  getTask,
  isBoardLoaded,
  listTasks,
  loadTaskBoard,
  persistTaskBoard,
  updateTask,
} from './task-board'
export {
  cleanupTeamConfig,
  createTeam,
  deleteTeam,
  loadPersistedTeam,
  persistTeamConfig,
} from './team-manager'
