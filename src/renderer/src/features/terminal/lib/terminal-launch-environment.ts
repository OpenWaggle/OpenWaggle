import type { TerminalOpenInput } from '@shared/types/terminal'
import { createProjectActionTerminalEnvironment } from '@shared/utils/terminal-environment'

export type TerminalLaunchEnvironment = TerminalOpenInput['env']

export function sameTerminalLaunchEnvironment(
  left: TerminalLaunchEnvironment,
  right: TerminalLaunchEnvironment,
) {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
}

/** Keeps action compatibility variables correct when a Local pane moves into its worktree. */
export function projectActionEnvironmentForWorktree(
  launchEnv: TerminalLaunchEnvironment,
  worktreePath: string,
) {
  if (launchEnv === undefined) return undefined
  const projectRoot = launchEnv.OPENWAGGLE_PROJECT_ROOT ?? launchEnv.T3CODE_PROJECT_ROOT
  if (projectRoot === undefined || projectRoot.length === 0) return undefined
  return createProjectActionTerminalEnvironment({
    projectRoot,
    worktreePath,
    overrides: launchEnv,
  })
}
