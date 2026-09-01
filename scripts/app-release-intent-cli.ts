import path from 'node:path'
import {
  createAppReleasePlan,
  prepareAppRelease,
  readAppManifestVersion,
  readAppReleaseIntents,
} from './app-release-intent'

const ARG_VALUE_OFFSET = 1
const CLI_COMMAND_INDEX = 2
const JSON_INDENT = 2

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + ARG_VALUE_OFFSET] : undefined
  if (value) return value
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required argument ${name}.`)
}

function run() {
  const command = process.argv[CLI_COMMAND_INDEX]
  const projectRoot = path.resolve(argument('--root', process.cwd()))
  if (command === 'validate') {
    const entries = readAppReleaseIntents(projectRoot)
    process.stdout.write(`Validated ${entries.length} desktop app release-intent file(s).\n`)
    return
  }
  if (command === 'plan') {
    const plan = createAppReleasePlan(
      readAppManifestVersion(projectRoot),
      readAppReleaseIntents(projectRoot),
    )
    process.stdout.write(`${JSON.stringify(plan, null, JSON_INDENT)}\n`)
    return
  }
  if (command === 'prepare') {
    prepareAppRelease(projectRoot, argument('--version'), argument('--date'))
    return
  }
  throw new Error(`Unsupported app release-intent command: ${String(command)}.`)
}

try {
  run()
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
