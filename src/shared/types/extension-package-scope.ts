import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { SchemaType } from '@shared/schema'
import type {
  extensionLifecycleMutationTargetSchema,
  extensionLifecycleScopeSchema,
} from '@shared/schemas/extensions'

export type ExtensionPackageScopeKind =
  | typeof OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
  | typeof OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND

export interface ExtensionPackageScopeView {
  readonly kind: ExtensionPackageScopeKind
  readonly label: string
  readonly projectPath?: string
}

export type ExtensionPackageLifecycleScope = SchemaType<typeof extensionLifecycleScopeSchema>
export type ExtensionLifecycleMutationTarget = SchemaType<
  typeof extensionLifecycleMutationTargetSchema
>
