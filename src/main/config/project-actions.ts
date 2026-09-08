import { safeDecodeUnknown } from '@shared/schema'
import { projectActionIdSchema } from '@shared/schemas/project-actions'
import {
  PROJECT_ACTION_LIMITS,
  type ProjectAction,
  type ProjectActionInput,
  type ProjectActionUpdate,
  type T3ProjectActionScript,
  type T3ProjectActionsDiscovery,
} from '@shared/types/project-actions'
import {
  assignMissingShortcutOrders,
  decodeProjectActionInput,
  decodeProjectActionUpdate,
  normalizeProjectActionInput,
  normalizeStoredProjectAction,
  projectActionFromUpdate,
  replaceStoredProjectAction,
} from './project-action-normalization'
import { loadProjectConfig, updateProjectConfig } from './project-config'
import { loadT3ProjectActions } from './t3-project-actions'

const ID_SUFFIX_START = 2
const ID_SUFFIX_HEADROOM = 2

function slugBase(name: string) {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (cleaned || 'script').slice(0, PROJECT_ACTION_LIMITS.ID_LENGTH).replace(/-+$/g, '')
}

/** Deterministic, bounded action id allocation compatible with T3's common ids. */
export function nextProjectActionId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds)
  const base = slugBase(name) || 'script'
  if (!taken.has(base)) return base

  for (
    let suffix = ID_SUFFIX_START;
    suffix <= PROJECT_ACTION_LIMITS.ACTIONS_PER_PROJECT + ID_SUFFIX_HEADROOM;
    suffix += 1
  ) {
    const suffixText = String(suffix)
    const baseLength = PROJECT_ACTION_LIMITS.ID_LENGTH - suffixText.length - 1
    const prefix = base.slice(0, baseLength).replace(/-+$/g, '') || 's'
    const candidate = `${prefix}-${suffixText}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error('Unable to allocate a unique project action id.')
}

function demotePreviousSetup<T extends { readonly runOnWorktreeCreate: boolean }>(
  actions: readonly T[],
  shouldDemote: boolean,
) {
  if (!shouldDemote) return [...actions]
  return actions.map((action) =>
    action.runOnWorktreeCreate ? { ...action, runOnWorktreeCreate: false } : action,
  )
}

function ensureActionCapacity(actions: readonly unknown[]) {
  if (actions.length >= PROJECT_ACTION_LIMITS.ACTIONS_PER_PROJECT) {
    throw new Error(
      `A project may have at most ${PROJECT_ACTION_LIMITS.ACTIONS_PER_PROJECT} actions.`,
    )
  }
}

function actionsFromConfig(config: Awaited<ReturnType<typeof loadProjectConfig>>) {
  return (config.actions ?? []).map(normalizeStoredProjectAction)
}

export async function listProjectActions(projectPath: string): Promise<readonly ProjectAction[]> {
  return actionsFromConfig(await loadProjectConfig(projectPath))
}

export async function addProjectAction(
  projectPath: string,
  rawInput: ProjectActionInput,
): Promise<readonly ProjectAction[]> {
  const decodedInput = decodeProjectActionInput(rawInput)
  const config = await updateProjectConfig(projectPath, (current) => {
    const existing = current.actions ?? []
    ensureActionCapacity(existing)
    const input = assignMissingShortcutOrders(
      normalizeProjectActionInput(decodedInput),
      existing.map(normalizeStoredProjectAction),
    )
    const action = {
      id: nextProjectActionId(
        input.name,
        existing.map((item) => item.id),
      ),
      ...input,
    }
    return {
      ...current,
      actions: [...demotePreviousSetup(existing, action.runOnWorktreeCreate), action],
    }
  })
  return actionsFromConfig(config)
}

export async function updateProjectAction(
  projectPath: string,
  actionId: string,
  rawUpdate: ProjectActionUpdate,
): Promise<readonly ProjectAction[]> {
  const decodedId = safeDecodeUnknown(projectActionIdSchema, actionId)
  if (!decodedId.success)
    throw new Error(`Invalid project action id: ${decodedId.issues.join('; ')}`)
  const update = decodeProjectActionUpdate(rawUpdate)
  const config = await updateProjectConfig(projectPath, (current) => {
    const existing = current.actions ?? []
    const storedCurrent = existing.find((action) => action.id === decodedId.data)
    if (!storedCurrent) throw new Error(`Project action "${decodedId.data}" was not found.`)
    const normalizedExisting = existing.map(normalizeStoredProjectAction)
    const nextWithoutOrders = projectActionFromUpdate(
      normalizeStoredProjectAction(storedCurrent),
      update,
    )
    const next = {
      id: nextWithoutOrders.id,
      ...assignMissingShortcutOrders(nextWithoutOrders, normalizedExisting),
    }
    const demoted = demotePreviousSetup(existing, next.runOnWorktreeCreate)
    return {
      ...current,
      actions: demoted.map((action) =>
        action.id === decodedId.data ? replaceStoredProjectAction(action, next) : action,
      ),
    }
  })
  return actionsFromConfig(config)
}

export async function deleteProjectAction(
  projectPath: string,
  actionId: string,
): Promise<readonly ProjectAction[]> {
  const decodedId = safeDecodeUnknown(projectActionIdSchema, actionId)
  if (!decodedId.success)
    throw new Error(`Invalid project action id: ${decodedId.issues.join('; ')}`)
  const config = await updateProjectConfig(projectPath, (current) => {
    const existing = current.actions ?? []
    const remaining = existing.filter((action) => action.id !== decodedId.data)
    if (remaining.length === existing.length) {
      throw new Error(`Project action "${decodedId.data}" was not found.`)
    }
    return { ...current, actions: remaining }
  })
  return actionsFromConfig(config)
}

function filterImportCandidates(
  scripts: readonly T3ProjectActionScript[],
  existing: readonly ProjectAction[],
) {
  const commands = new Set(existing.map((action) => action.command))
  const names = new Set(existing.map((action) => action.name.toLowerCase()))
  return scripts.filter((script) => {
    const normalizedName = script.name.toLowerCase()
    if (commands.has(script.command) || names.has(normalizedName)) return false
    commands.add(script.command)
    names.add(normalizedName)
    return true
  })
}

export async function discoverT3ProjectActions(
  projectPath: string,
): Promise<T3ProjectActionsDiscovery> {
  const discovered = await loadT3ProjectActions(projectPath)
  if (discovered.status !== 'valid') return discovered
  const candidates = filterImportCandidates(
    discovered.scripts,
    await listProjectActions(projectPath),
  )
  return { ...discovered, candidates }
}

export async function importT3ProjectAction(
  projectPath: string,
  sourceIndex: number,
): Promise<readonly ProjectAction[]> {
  const discovered = await discoverT3ProjectActions(projectPath)
  if (discovered.status === 'missing') throw new Error('Cannot import: t3.json is missing.')
  if (discovered.status === 'invalid') throw new Error(`Cannot import: ${discovered.error}`)
  const source = discovered.candidates.find((script) => script.sourceIndex === sourceIndex)
  if (!source) throw new Error('The selected t3.json action is unavailable or already imported.')

  const decodedInput = decodeProjectActionInput(source)
  const config = await updateProjectConfig(projectPath, (current) => {
    const existing = current.actions ?? []
    const input = assignMissingShortcutOrders(
      normalizeProjectActionInput(decodedInput),
      existing.map(normalizeStoredProjectAction),
    )
    if (
      existing.some(
        (action) =>
          action.command === input.command ||
          action.name.toLowerCase() === input.name.toLowerCase(),
      )
    ) {
      throw new Error('The selected t3.json action is already imported.')
    }
    ensureActionCapacity(existing)
    const action = {
      id: nextProjectActionId(
        input.name,
        existing.map((item) => item.id),
      ),
      ...input,
    }
    return {
      ...current,
      actions: [...demotePreviousSetup(existing, action.runOnWorktreeCreate), action],
    }
  })
  return actionsFromConfig(config)
}
