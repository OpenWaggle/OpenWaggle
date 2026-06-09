import { matchBy } from '@diegogbrisa/ts-match'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { loadWithRuntimeFailureIsolation } from '../../../extensions/runtime-load-isolation'
import type { RuntimeEnabledOpenWaggleExtensionPackage } from '../openwaggle-pi-extension-selection'
import { createPiProjectModelRuntime, type PiProjectModelRuntime } from '../pi-provider-catalog'
import {
  getPiRuntimeExtensionLoadErrors,
  rejectMatchingOpenWaggleExtensionLoadErrors,
} from '../pi-runtime-extension-load-errors'

interface RuntimePackageSelection {
  readonly type: 'runtime-enabled-package'
  readonly packagePath: string
  readonly selection: RuntimeEnabledOpenWaggleExtensionPackage
}

interface RuntimePackagePathSelection {
  readonly type: 'package-path'
  readonly packagePath: string
}

type RuntimeExtensionSelection = RuntimePackageSelection | RuntimePackagePathSelection

export interface PiProjectRuntimeIsolationOptions {
  readonly projectPath: string
  readonly modelReference: string
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly extensionFactories?: readonly ExtensionFactory[]
}

export interface IsolatedPiProjectModelRuntime {
  readonly runtime: PiProjectModelRuntime
  readonly enabledOpenWaggleExtensionPackagePaths: readonly string[]
}

export interface PiRuntimeExtensionIsolationInput {
  readonly enabledOpenWaggleExtensionPackages?: readonly RuntimeEnabledOpenWaggleExtensionPackage[]
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
  readonly recordOpenWaggleExtensionRuntimeFailure?: (
    selection: RuntimeEnabledOpenWaggleExtensionPackage,
    error: unknown,
    operation: string,
  ) => Promise<void>
}

function packageSelections(
  packages: readonly RuntimeEnabledOpenWaggleExtensionPackage[],
): readonly RuntimeExtensionSelection[] {
  return packages.map((selection) => ({
    type: 'runtime-enabled-package',
    packagePath: selection.packagePath,
    selection,
  }))
}

function pathSelections(packagePaths: readonly string[]): readonly RuntimeExtensionSelection[] {
  return packagePaths.map((packagePath) => ({
    type: 'package-path',
    packagePath,
  }))
}

function runtimeExtensionSelections(
  input: Pick<
    PiRuntimeExtensionIsolationInput,
    'enabledOpenWaggleExtensionPackages' | 'enabledOpenWaggleExtensionPackagePaths'
  >,
): readonly RuntimeExtensionSelection[] {
  if (input.enabledOpenWaggleExtensionPackages) {
    return packageSelections(input.enabledOpenWaggleExtensionPackages)
  }

  return pathSelections(input.enabledOpenWaggleExtensionPackagePaths ?? [])
}

async function recordRuntimeExtensionFailure(
  input: Pick<PiRuntimeExtensionIsolationInput, 'recordOpenWaggleExtensionRuntimeFailure'> & {
    readonly selection: RuntimeExtensionSelection
    readonly error: unknown
    readonly operation: string
  },
) {
  return matchBy(input.selection, 'type')
    .with('runtime-enabled-package', (runtimeSelection) =>
      input.recordOpenWaggleExtensionRuntimeFailure?.(
        runtimeSelection.selection,
        input.error,
        input.operation,
      ),
    )
    .with('package-path', () => undefined)
    .exhaustive()
}

export async function createPiProjectModelRuntimeWithoutOpenWaggleExtensions(
  options: PiProjectRuntimeIsolationOptions,
) {
  return createPiProjectModelRuntime({
    projectPath: options.projectPath,
    modelReference: options.modelReference,
    ...(options.skillToggles ? { skillToggles: options.skillToggles } : {}),
    ...(options.extensionFactories ? { extensionFactories: options.extensionFactories } : {}),
  })
}

export async function createIsolatedPiProjectRuntime(input: {
  readonly operation: string
  readonly extensionIsolation: PiRuntimeExtensionIsolationInput
  readonly options: PiProjectRuntimeIsolationOptions
}): Promise<IsolatedPiProjectModelRuntime> {
  return loadPiRuntimeWithExtensionFailureIsolation({
    operation: input.operation,
    extensionIsolation: input.extensionIsolation,
    load: async (enabledOpenWaggleExtensionPackagePaths) => {
      const runtime = await createPiProjectModelRuntime({
        projectPath: input.options.projectPath,
        modelReference: input.options.modelReference,
        ...(input.options.skillToggles ? { skillToggles: input.options.skillToggles } : {}),
        ...(enabledOpenWaggleExtensionPackagePaths.length > 0
          ? { enabledOpenWaggleExtensionPackagePaths }
          : {}),
        ...(input.options.extensionFactories
          ? { extensionFactories: input.options.extensionFactories }
          : {}),
      })
      return {
        runtime: rejectMatchingOpenWaggleExtensionLoadErrors({
          result: runtime,
          errors: getPiRuntimeExtensionLoadErrors(runtime.services),
          enabledOpenWaggleExtensionPackagePaths,
        }),
        enabledOpenWaggleExtensionPackagePaths,
      }
    },
  })
}

export async function loadPiRuntimeWithExtensionFailureIsolation<Result>(input: {
  readonly operation: string
  readonly extensionIsolation: PiRuntimeExtensionIsolationInput
  readonly load: (enabledOpenWaggleExtensionPackagePaths: readonly string[]) => Promise<Result>
}): Promise<Result> {
  return loadWithRuntimeFailureIsolation({
    selections: runtimeExtensionSelections(input.extensionIsolation),
    load: input.load,
    recordFailure: (selection, error) =>
      recordRuntimeExtensionFailure({
        selection,
        error,
        operation: input.operation,
        recordOpenWaggleExtensionRuntimeFailure:
          input.extensionIsolation.recordOpenWaggleExtensionRuntimeFailure,
      }),
  })
}
