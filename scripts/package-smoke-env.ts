export interface PackageSmokeEnvironment {
  readonly browserExecutablePath: string | undefined
  readonly browserSmokeEnabled: boolean
}

export function packageBrowserSmokeEnabled(value: string | undefined) {
  return value === '1'
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
  }
}
