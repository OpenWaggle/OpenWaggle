import type { ShortcutBinding } from './shortcuts'

export const PROJECT_ACTION_ICONS = ['play', 'test', 'lint', 'configure', 'build', 'debug'] as const

export type ProjectActionIcon = (typeof PROJECT_ACTION_ICONS)[number]

export const PROJECT_ACTION_LIMITS = {
  ACTIONS_PER_PROJECT: 50,
  COMMAND_LENGTH: 8_192,
  ID_LENGTH: 24,
  IPC_PAYLOAD_BYTES: 128 * 1_024,
  NAME_LENGTH: 120,
  PREVIEW_URL_LENGTH: 2_048,
  PROJECT_PATH_LENGTH: 4_096,
  SHORTCUT_KEY_LENGTH: 64,
  SHORTCUT_RULES_PER_PROJECT: 256,
  SHORTCUT_WHEN_DEPTH: 64,
  SHORTCUT_WHEN_LENGTH: 256,
  T3_FILE_BYTES: 256 * 1_024,
} as const

export interface ProjectActionShortcutRule {
  readonly shortcut: ShortcutBinding
  readonly when?: string
  /**
   * Global precedence among this project's action shortcuts. Later orders win.
   * Optional so pre-rule and hand-authored project settings remain readable.
   */
  readonly order?: number
}

/** A saved project action from `.openwaggle/settings.json`. */
export interface ProjectAction {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly icon: ProjectActionIcon
  readonly runOnWorktreeCreate: boolean
  readonly previewUrl?: string
  readonly autoOpenPreview?: boolean
  readonly shortcutRules?: readonly ProjectActionShortcutRule[]
  /** @deprecated Read-only compatibility for settings written before shortcut rules. */
  readonly shortcut?: ShortcutBinding
}

/** User-authored fields for a new project action. */
export interface ProjectActionInput {
  readonly name: string
  readonly command: string
  readonly icon?: ProjectActionIcon
  readonly runOnWorktreeCreate?: boolean
  readonly previewUrl?: string | null
  readonly autoOpenPreview?: boolean
  readonly shortcutRules?: readonly ProjectActionShortcutRule[] | null
  /** @deprecated Use `shortcutRules`. */
  readonly shortcut?: ShortcutBinding | null
}

/** Partial edit. `null` clears optional preview and shortcut fields. */
export interface ProjectActionUpdate {
  readonly name?: string
  readonly command?: string
  readonly icon?: ProjectActionIcon
  readonly runOnWorktreeCreate?: boolean
  readonly previewUrl?: string | null
  readonly autoOpenPreview?: boolean
  readonly shortcutRules?: readonly ProjectActionShortcutRule[] | null
  /** @deprecated Use `shortcutRules`. */
  readonly shortcut?: ShortcutBinding | null
}

/** A normalized script discovered in the checked-in root `t3.json`. */
export interface T3ProjectActionScript {
  readonly sourceIndex: number
  readonly name: string
  readonly command: string
  readonly icon: ProjectActionIcon
  readonly runOnWorktreeCreate: boolean
  readonly previewUrl?: string
  readonly autoOpenPreview?: boolean
}

interface T3ProjectActionsMissing {
  readonly status: 'missing'
  readonly scripts: readonly []
  readonly candidates: readonly []
}

interface T3ProjectActionsInvalid {
  readonly status: 'invalid'
  readonly scripts: readonly []
  readonly candidates: readonly []
  readonly error: string
}

interface T3ProjectActionsValid {
  readonly status: 'valid'
  readonly scripts: readonly T3ProjectActionScript[]
  /** Scripts not already represented by exact command or case-insensitive name. */
  readonly candidates: readonly T3ProjectActionScript[]
}

export type T3ProjectActionsDiscovery =
  | T3ProjectActionsMissing
  | T3ProjectActionsInvalid
  | T3ProjectActionsValid
