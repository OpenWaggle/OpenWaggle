import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

export type ExtensionPackageScopeKind =
  | typeof OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
  | typeof OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND

export interface ExtensionPackageScopeView {
  readonly kind: ExtensionPackageScopeKind
  readonly label: string
  readonly projectPath?: string
}

export type ExtensionPackageLifecycleScope =
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    }
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
      readonly projectPath: string
    }

export interface ExtensionLifecycleMutationTarget {
  readonly extensionId: string
  readonly scope: ExtensionPackageLifecycleScope
  readonly viewProjectPaths?: readonly string[]
}
