import type { ProjectActionIcon, ProjectActionShortcutRule } from './project-actions'

export const ACTION_DEFINITION_LIMITS = {
  DEFINITIONS: 100,
  PROFILES: 20,
  ID_LENGTH: 128,
  NAME_LENGTH: 120,
  COMMAND_LENGTH: 8_192,
  PATH_LENGTH: 4_096,
  FILE_BYTES: 1_024 * 1_024,
  DISCOVERED_TASKS: 1_000,
  WORKSPACE_PACKAGES: 250,
} as const

export type ActionStorage = 'local' | 'project'
export type ActionDefinitionSource = ActionStorage | 'override'
export type ProjectTaskProvider = 'package-script' | 'hatch-script' | 'cargo-alias'

/** Portable identity; resolved again against the workspace at each new launch. */
export interface ProjectTaskReference {
  readonly provider: ProjectTaskProvider
  readonly source: string
  readonly task: string
  readonly directory: string
  readonly environment?: string
}

export type ActionInvocation =
  | { readonly type: 'command'; readonly command: string; readonly directory: string }
  | { readonly type: 'task'; readonly task: ProjectTaskReference }

export interface ActionDefinition {
  readonly id: string
  readonly name: string
  readonly icon: ProjectActionIcon
  readonly invocation: ActionInvocation
  readonly kind: 'task' | 'service'
  readonly allowConcurrent: boolean
  readonly autoOpenPreview: boolean
  readonly previewUrl?: string
  readonly shortcutRules?: readonly ProjectActionShortcutRule[]
}

export interface PreparationProfile {
  readonly id: string
  readonly name: string
}

export interface PreparationDefinition {
  readonly id: string
  readonly profileId: string
  readonly phase: 'setup' | 'cleanup'
  readonly invocation: ActionInvocation
}

/** The only shape written into the checkout. No grants, runtime environment or history. */
export interface ActionManifest {
  readonly version: 1
  readonly actions: readonly ActionDefinition[]
  readonly profiles: readonly PreparationProfile[]
  readonly preparation: readonly PreparationDefinition[]
}

export interface EffectiveDefinition<T> {
  readonly definition: T
  readonly source: ActionDefinitionSource
}

export interface PreparationReview {
  readonly definitionId: string
  readonly fingerprint: string
  readonly invocation: ActionInvocation
  readonly enabled: boolean
}

export interface ActionCatalog {
  readonly revision: string
  readonly pendingPublication?: {
    readonly workspacePath: string
    readonly projectDraft: ActionManifest
    readonly localDraft: ActionManifest
  }
  readonly actions: readonly EffectiveDefinition<ActionDefinition>[]
  readonly profiles: readonly EffectiveDefinition<PreparationProfile>[]
  readonly preparation: readonly (EffectiveDefinition<PreparationDefinition> & {
    readonly review: 'enabled' | 'disabled' | 'required'
    readonly previous?: PreparationReview
  })[]
}

export type ActionCatalogEdit =
  | { readonly type: 'discard-publication' }
  | {
      readonly type: 'move-definition'
      readonly collection: 'actions' | 'profiles' | 'preparation'
      readonly id: string
      readonly storage: ActionStorage
    }
  | {
      readonly type: 'save-action'
      readonly definition: ActionDefinition
      readonly storage: ActionStorage
    }
  | { readonly type: 'delete-action'; readonly id: string; readonly storage: ActionStorage }
  | {
      readonly type: 'save-profile'
      readonly definition: PreparationProfile
      readonly storage: ActionStorage
    }
  | { readonly type: 'delete-profile'; readonly id: string; readonly storage: ActionStorage }
  | {
      readonly type: 'save-preparation'
      readonly definition: PreparationDefinition
      readonly storage: ActionStorage
    }
  | { readonly type: 'delete-preparation'; readonly id: string; readonly storage: ActionStorage }
  | { readonly type: 'review-preparation'; readonly id: string; readonly enabled: boolean }

export interface DiscoveredProjectTask {
  readonly reference: ProjectTaskReference
  readonly group: string
  readonly description: string
  readonly runner: string | null
  readonly unavailableReason?: string
}

export interface ProjectTaskDiscovery {
  readonly tasks: readonly DiscoveredProjectTask[]
  readonly diagnostics: readonly { readonly source: string; readonly message: string }[]
}

export type ResolvedActionInvocation =
  | { readonly type: 'command'; readonly command: string; readonly cwd: string }
  | {
      readonly type: 'executable'
      readonly executable: string
      readonly args: readonly string[]
      readonly cwd: string
    }
