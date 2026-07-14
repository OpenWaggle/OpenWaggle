import { fileURLToPath } from 'node:url'
import { createDefaultBootstrapDependencies } from './package-release-bootstrap-adapters'
import { redactBootstrapDiagnostic } from './package-release-bootstrap-commands'
import { executeBootstrap } from './package-release-bootstrap-execute'
import { inspectBootstrapPreflight } from './package-release-bootstrap-preflight'
import type {
  BootstrapCommandRequest,
  BootstrapCommandResult,
  BootstrapDependencies,
  PackageReleaseBootstrapInput,
  PackageReleaseBootstrapResult,
} from './package-release-bootstrap-types'

export type {
  BootstrapCommandRequest,
  BootstrapCommandResult,
  BootstrapDependencies,
  PackageReleaseBootstrapResult,
} from './package-release-bootstrap-types'

const FAILURE_EXIT_CODE = 1
const USER_ARGUMENT_START_INDEX = 2

function parseMode(args: readonly string[]) {
  if (args.some((arg) => /(?:auth|otp|token)/iu.test(arg))) {
    throw new Error('Credential arguments are not supported; use authenticated npm and gh sessions.')
  }
  if (args.length === 0) return 'preflight' as const
  if (args.length === 1 && args[0] === '--execute') return 'execute' as const
  throw new Error('Unknown bootstrap arguments; expected only --execute.')
}

export async function runPackageReleaseBootstrap(
  input: PackageReleaseBootstrapInput,
  dependencies: BootstrapDependencies,
): Promise<PackageReleaseBootstrapResult> {
  const mode = parseMode(input.args)
  const preflight = await inspectBootstrapPreflight(input.projectRoot, dependencies)
  const hasConflict = preflight.packages.some((item) => item.state === 'conflict')
  const ok =
    preflight.blockers.length === 0 &&
    !hasConflict &&
    preflight.github.environment !== 'conflict' &&
    preflight.github.ruleset !== 'conflict'
  if (mode === 'execute' && ok) {
    return executeBootstrap(input, dependencies, preflight.packages, preflight.github)
  }
  const nextAction =
    mode === 'preflight' && ok
      ? 'Run pnpm package-release:bootstrap --execute.'
      : 'Resolve every blocker and rerun the preflight.'
  dependencies.writeLine(`Package namespace bootstrap ${mode}: ${ok ? 'ready' : 'blocked'}.`)
  return { ...preflight, mode, nextAction, ok }
}

function printBootstrapResult(result: PackageReleaseBootstrapResult) {
  for (const packageProgress of result.packages) {
    console.log(
      `[package] ${packageProgress.name}: ${packageProgress.state}; next: ${packageProgress.nextAction}`,
    )
  }
  console.log(`[github] npm environment: ${result.github.environment}`)
  console.log(`[github] main ruleset: ${result.github.ruleset}`)
  for (const blocker of result.blockers) console.error(`[blocker] ${blocker}`)
  console.log(`[next] ${result.nextAction}`)
}

async function main() {
  const result = await runPackageReleaseBootstrap(
    { args: process.argv.slice(USER_ARGUMENT_START_INDEX), projectRoot: process.cwd() },
    createDefaultBootstrapDependencies(),
  )
  printBootstrapResult(result)
  if (!result.ok) process.exitCode = FAILURE_EXIT_CODE
}

const currentModulePath = fileURLToPath(import.meta.url)
if (process.argv[1] === currentModulePath) {
  void main().catch((error: unknown) => {
    console.error(`[blocker] ${redactBootstrapDiagnostic(String(error))}`)
    process.exitCode = FAILURE_EXIT_CODE
  })
}
