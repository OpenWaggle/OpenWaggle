import { type SchemaType, safeDecodeUnknown } from '@shared/schema'
import {
  projectActionInputSchema,
  projectActionUpdateSchema,
  type storedProjectActionSchema,
} from '@shared/schemas/project-actions'
import type {
  ProjectAction,
  ProjectActionInput,
  ProjectActionShortcutRule,
} from '@shared/types/project-actions'
import { type ShortcutBinding, shortcutBindingKey } from '@shared/types/shortcuts'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'
import {
  orderedProjectActionShortcuts,
  projectActionShortcutRules,
} from '@shared/utils/project-action-shortcuts'

export type DecodedProjectActionInput = SchemaType<typeof projectActionInputSchema>
export type DecodedProjectActionUpdate = SchemaType<typeof projectActionUpdateSchema>
export type StoredProjectAction = SchemaType<typeof storedProjectActionSchema>

export interface NormalizedProjectActionInput {
  readonly name: string
  readonly command: string
  readonly icon: ProjectAction['icon']
  readonly runOnWorktreeCreate: boolean
  readonly previewUrl?: string
  readonly autoOpenPreview?: boolean
  readonly shortcutRules?: ProjectActionShortcutRule[]
}

export type NormalizedProjectAction = NormalizedProjectActionInput & { readonly id: string }

export function decodeProjectActionInput(input: unknown): DecodedProjectActionInput {
  const decoded = safeDecodeUnknown(projectActionInputSchema, input)
  if (!decoded.success) {
    throw new Error(`Invalid project action: ${decoded.issues.join('; ')}`)
  }
  return decoded.data
}

export function decodeProjectActionUpdate(input: unknown): DecodedProjectActionUpdate {
  const decoded = safeDecodeUnknown(projectActionUpdateSchema, input)
  if (!decoded.success) {
    throw new Error(`Invalid project action update: ${decoded.issues.join('; ')}`)
  }
  return decoded.data
}

function normalizeShortcut(shortcut: ShortcutBinding | null | undefined) {
  if (!shortcut) return undefined
  return {
    key: shortcut.key.trim(),
    ...(shortcut.mod === true ? { mod: true } : {}),
    ...(shortcut.ctrl === true ? { ctrl: true } : {}),
    ...(shortcut.shift === true ? { shift: true } : {}),
    ...(shortcut.alt === true ? { alt: true } : {}),
    ...(shortcut.meta === true ? { meta: true } : {}),
  }
}

function normalizeShortcutRules(input: DecodedProjectActionInput) {
  const sourceRules =
    input.shortcutRules !== undefined
      ? (input.shortcutRules ?? [])
      : input.shortcut
        ? [{ shortcut: input.shortcut }]
        : []
  const normalized: ProjectActionShortcutRule[] = []
  const seen = new Set<string>()

  for (let index = sourceRules.length - 1; index >= 0; index -= 1) {
    const rule = sourceRules[index]
    if (rule === undefined) continue
    const shortcut = normalizeShortcut(rule.shortcut)
    if (shortcut === undefined) continue
    const when = rule.when?.trim()
    const identity = `${shortcutBindingKey(shortcut)}\u0000${when ?? ''}`
    if (seen.has(identity)) continue
    seen.add(identity)
    normalized.unshift({
      shortcut,
      ...(when ? { when } : {}),
      ...(rule.order === undefined ? {} : { order: rule.order }),
    })
  }
  return normalized
}

export function normalizeProjectActionInput(
  input: DecodedProjectActionInput,
): NormalizedProjectActionInput {
  const previewUrl = input.previewUrl ? normalizeBrowserPreviewAddress(input.previewUrl) : null
  const shortcutRules = normalizeShortcutRules(input)
  return {
    name: input.name.trim(),
    command: input.command.trim(),
    icon: input.icon ?? 'play',
    runOnWorktreeCreate: input.runOnWorktreeCreate ?? false,
    ...(previewUrl !== null ? { previewUrl, autoOpenPreview: input.autoOpenPreview === true } : {}),
    ...(shortcutRules.length > 0 ? { shortcutRules } : {}),
  }
}

export function normalizeStoredProjectAction(action: ProjectAction): ProjectAction {
  return { id: action.id, ...normalizeProjectActionInput(decodeProjectActionInput(action)) }
}

export function projectActionFromUpdate(
  current: ProjectAction,
  update: DecodedProjectActionUpdate,
) {
  const shortcutRules =
    update.shortcutRules !== undefined
      ? update.shortcutRules
      : update.shortcut !== undefined
        ? update.shortcut === null
          ? null
          : [{ shortcut: update.shortcut }]
        : projectActionShortcutRules(current)
  const input: ProjectActionInput = {
    name: update.name ?? current.name,
    command: update.command ?? current.command,
    icon: update.icon ?? current.icon,
    runOnWorktreeCreate: update.runOnWorktreeCreate ?? current.runOnWorktreeCreate,
    previewUrl: update.previewUrl === undefined ? (current.previewUrl ?? null) : update.previewUrl,
    autoOpenPreview: update.autoOpenPreview ?? current.autoOpenPreview ?? false,
    shortcutRules,
  }
  return { id: current.id, ...normalizeProjectActionInput(decodeProjectActionInput(input)) }
}

export function assignMissingShortcutOrders(
  action: NormalizedProjectActionInput,
  existing: readonly ProjectAction[],
) {
  if (action.shortcutRules === undefined) return action
  let nextOrder =
    orderedProjectActionShortcuts(existing).reduce(
      (maximum, entry) => Math.max(maximum, entry.order),
      -1,
    ) + 1
  return {
    ...action,
    shortcutRules: action.shortcutRules.map((rule) => {
      if (rule.order !== undefined) return rule
      const ordered = { ...rule, order: nextOrder }
      nextOrder += 1
      return ordered
    }),
  }
}

export function replaceStoredProjectAction(
  stored: StoredProjectAction,
  next: NormalizedProjectAction,
): StoredProjectAction {
  const replaced = {
    ...stored,
    ...next,
    ...(next.shortcutRules === undefined
      ? {}
      : { shortcutRules: next.shortcutRules.map((rule) => ({ ...rule })) }),
  }
  if (!next.previewUrl) {
    Reflect.deleteProperty(replaced, 'previewUrl')
    Reflect.deleteProperty(replaced, 'autoOpenPreview')
  }
  Reflect.deleteProperty(replaced, 'shortcut')
  if (!next.shortcutRules) Reflect.deleteProperty(replaced, 'shortcutRules')
  return replaced
}
