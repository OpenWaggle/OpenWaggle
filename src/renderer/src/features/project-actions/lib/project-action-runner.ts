import type { ProjectAction } from '@shared/types/project-actions'
import type { TerminalActivityStatus } from '@shared/types/terminal'
import { createProjectActionTerminalEnvironment } from '@shared/utils/terminal-environment'
import type { TerminalProjectActionEnqueueResult } from '@/features/terminal'
import {
  runtimeKeyOf,
  sameTerminalLaunchEnvironment,
  type TerminalGroupState,
  type TerminalLaunchEnvironment,
} from '@/features/terminal'

interface ProjectActionTerminalSnapshot {
  readonly groups: Readonly<Record<string, TerminalGroupState>>
  readonly exits: Readonly<Record<string, number>>
}

interface ProjectActionInputClient {
  enqueueProjectAction(
    data: string,
    executionId: string,
  ): Promise<TerminalProjectActionEnqueueResult>
  markUnavailable(): void
  release(): void
}

export interface ProjectActionRunDependencies {
  readonly terminalSnapshot: () => ProjectActionTerminalSnapshot
  readonly resolveLayoutOwner: (
    ownerKey: string,
    groups: Readonly<Record<string, TerminalGroupState>>,
  ) => string
  readonly getActivityStatus: (ownerKey: string, terminalId: string) => TerminalActivityStatus
  readonly getProjectActionPending: (ownerKey: string, terminalId: string) => boolean
  readonly hasPendingInputAction: (ownerKey: string, terminalId: string) => boolean
  readonly createTerminal: (
    layoutOwnerKey: string,
    cwd: string,
    launchEnv: TerminalLaunchEnvironment,
  ) => string | null
  readonly setPaneLaunchEnv: (
    layoutOwnerKey: string,
    terminalId: string,
    launchEnv: TerminalLaunchEnvironment,
  ) => void
  readonly setPanelOpen: (layoutOwnerKey: string) => void
  readonly showSideTerminal: (ownerKey: string) => void
  readonly acquireInput: (ownerKey: string, terminalId: string) => ProjectActionInputClient
  readonly openPreview: (ownerKey: string, url: string) => void | Promise<void>
}

export interface ProjectActionRunContext {
  readonly projectPath: string
  readonly ownerKey: string
  readonly workingPath: string
  readonly worktreeMode: boolean
}

interface ResolvedActionTerminal {
  readonly layoutOwnerKey: string
  readonly terminalId: string | null
  readonly launchEnv: TerminalLaunchEnvironment
  readonly reusable: boolean
}

export interface ProjectActionRunResult {
  readonly terminalId: string
  readonly reused: boolean
  readonly previewError: Error | null
}

export function projectActionLaunchEnvironment(
  projectPath: string,
  workingPath: string,
  worktreeMode: boolean,
): Readonly<Record<string, string>> {
  return createProjectActionTerminalEnvironment({
    projectRoot: projectPath,
    ...(worktreeMode ? { worktreePath: workingPath } : {}),
  })
}

function activePane(group: TerminalGroupState | undefined) {
  if (group === undefined) return null
  const tab =
    group.tabs.find((candidate) => candidate.id === group.activeTabId) ??
    group.tabs[group.tabs.length - 1]
  if (tab === undefined) return null
  return tab.panes.find((pane) => pane.terminalId === tab.activePaneId) ?? tab.panes[0] ?? null
}

function resolveActionTerminal(
  context: ProjectActionRunContext,
  dependencies: ProjectActionRunDependencies,
): ResolvedActionTerminal {
  const snapshot = dependencies.terminalSnapshot()
  const layoutOwnerKey = dependencies.resolveLayoutOwner(context.ownerKey, snapshot.groups)
  const pane = activePane(snapshot.groups[layoutOwnerKey])
  const runtimeKey = pane === null ? null : runtimeKeyOf(context.ownerKey, pane.terminalId)
  const activityStatus =
    pane === null ? 'unknown' : dependencies.getActivityStatus(context.ownerKey, pane.terminalId)
  const reusable =
    pane !== null &&
    pane.cwd === context.workingPath &&
    activityStatus === 'idle' &&
    runtimeKey !== null &&
    !dependencies.getProjectActionPending(context.ownerKey, pane.terminalId) &&
    !dependencies.hasPendingInputAction(context.ownerKey, pane.terminalId) &&
    snapshot.exits[runtimeKey] === undefined
  return {
    layoutOwnerKey,
    terminalId: reusable ? (pane?.terminalId ?? null) : null,
    launchEnv: projectActionLaunchEnvironment(
      context.projectPath,
      context.workingPath,
      context.worktreeMode,
    ),
    reusable,
  }
}

function inputRejected(
  result: TerminalProjectActionEnqueueResult,
): result is Extract<TerminalProjectActionEnqueueResult, { readonly status: 'rejected' }> {
  return result.status === 'rejected'
}

async function enqueueActionCommand(
  inputClient: ProjectActionInputClient,
  command: string,
  executionId: string,
) {
  try {
    return await inputClient.enqueueProjectAction(`${command}\r`, executionId)
  } finally {
    inputClient.release()
  }
}

function createActionTerminal(
  resolved: ResolvedActionTerminal,
  context: ProjectActionRunContext,
  dependencies: ProjectActionRunDependencies,
) {
  const terminalId = dependencies.createTerminal(
    resolved.layoutOwnerKey,
    context.workingPath,
    resolved.launchEnv,
  )
  if (terminalId === null) throw new Error('Could not create a terminal for this action.')
  return terminalId
}

function acquireActionInput(
  terminalId: string,
  reused: boolean,
  resolved: ResolvedActionTerminal,
  context: ProjectActionRunContext,
  dependencies: ProjectActionRunDependencies,
) {
  const inputClient = dependencies.acquireInput(context.ownerKey, terminalId)
  if (!reused) return inputClient
  const pane = activePane(dependencies.terminalSnapshot().groups[resolved.layoutOwnerKey])
  if (!sameTerminalLaunchEnvironment(pane?.launchEnv, resolved.launchEnv)) {
    inputClient.markUnavailable()
    dependencies.setPaneLaunchEnv(resolved.layoutOwnerKey, terminalId, resolved.launchEnv)
  }
  return inputClient
}

export async function executeProjectAction(
  action: ProjectAction,
  context: ProjectActionRunContext,
  dependencies: ProjectActionRunDependencies,
): Promise<ProjectActionRunResult> {
  if (context.ownerKey.length === 0 || context.workingPath.length === 0) {
    throw new Error('Open a project before running an action.')
  }
  const resolved = resolveActionTerminal(context, dependencies)
  let reused = resolved.reusable
  let terminalId = resolved.terminalId ?? createActionTerminal(resolved, context, dependencies)

  dependencies.setPanelOpen(resolved.layoutOwnerKey)
  if (resolved.layoutOwnerKey !== context.ownerKey) dependencies.showSideTerminal(context.ownerKey)
  const executionId = globalThis.crypto.randomUUID()
  let inputResult = await enqueueActionCommand(
    acquireActionInput(terminalId, reused, resolved, context, dependencies),
    action.command,
    executionId,
  )
  // The full activity snapshot can still read idle between main accepting the
  // previous action and the pushed revision reaching this renderer. Main owns
  // the definitive barrier; a rejection retries exactly once in a fresh PTY.
  if (inputRejected(inputResult) && inputResult.reason === 'project-action-pending' && reused) {
    terminalId = createActionTerminal(resolved, context, dependencies)
    reused = false
    inputResult = await enqueueActionCommand(
      acquireActionInput(terminalId, false, resolved, context, dependencies),
      action.command,
      executionId,
    )
  }
  if (inputRejected(inputResult)) throw new Error(inputResult.error)

  let previewError: Error | null = null
  if (action.previewUrl !== undefined && action.autoOpenPreview === true) {
    try {
      await dependencies.openPreview(context.ownerKey, action.previewUrl)
    } catch (error) {
      previewError = error instanceof Error ? error : new Error('Could not open action preview.')
    }
  }
  return { terminalId, reused, previewError }
}
