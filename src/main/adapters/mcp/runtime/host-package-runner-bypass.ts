import path from 'node:path'
import { createLogger } from '../../../logger'
import { mcpBuildStateDirectory } from '../credentials/mcp-build-state-paths'
import { fileBackedPackageBinStore, PackageRunnerBypass } from './mcp-package-runner-bypass'

const logger = createLogger('mcp-package-runner')

let bypass: PackageRunnerBypass | undefined

/** The Host's package-runner resolutions, kept next to its other MCP state (D1.2). */
export function hostPackageRunnerBypass() {
  bypass ??= new PackageRunnerBypass({
    store: fileBackedPackageBinStore(() =>
      path.join(mcpBuildStateDirectory(), 'package-runner-bins.json'),
    ),
    onProbeFailed: (error, launch) => {
      logger.warn('Could not resolve an MCP package runner launch; it keeps the runner', {
        runner: launch.runner,
        packageSpec: launch.packageSpec,
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })
  return bypass
}

/** Tests replace the Host's resolutions with their own. */
export function setHostPackageRunnerBypassForTests(next: PackageRunnerBypass | undefined) {
  bypass = next
}
