import { isMatching, P } from '@diegogbrisa/ts-match'

export const PACKAGE_MANAGER_NAMES = ['npm', 'pnpm', 'yarn', 'bun'] as const
export type PackageManagerName = (typeof PACKAGE_MANAGER_NAMES)[number]

const packageManagerNamePattern = P.union(...PACKAGE_MANAGER_NAMES)

export interface PackageSmokeEnvironment {
  readonly browserExecutablePath: string | undefined
  readonly browserSmokeEnabled: boolean
  readonly requiredPackageManagers: readonly PackageManagerName[]
}

export function packageBrowserSmokeEnabled(value: string | undefined) {
  return value === '1'
}

export function packageSmokeRequiredPackageManagers(value: string | undefined) {
  const required: PackageManagerName[] = []
  for (const name of value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? []) {
    if (!isMatching(packageManagerNamePattern, name)) {
      throw new Error(`Unsupported required package manager: ${name}.`)
    }
    if (!required.includes(name)) {
      required.push(name)
    }
  }
  return required
}

export function readPackageSmokeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): PackageSmokeEnvironment {
  const executablePath = environment.OPENWAGGLE_PACKAGE_BROWSER_EXECUTABLE?.trim()

  return {
    browserExecutablePath: executablePath || undefined,
    browserSmokeEnabled: packageBrowserSmokeEnabled(
      environment.OPENWAGGLE_PACKAGE_BROWSER_SMOKE,
    ),
    requiredPackageManagers: packageSmokeRequiredPackageManagers(
      environment.OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS,
    ),
  }
}
