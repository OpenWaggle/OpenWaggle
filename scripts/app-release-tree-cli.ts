import path from 'node:path'
import { verifyGeneratedAppReleaseTree } from './app-release-tree'

const ARG_VALUE_OFFSET = 1
const CLI_COMMAND_INDEX = 2

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + ARG_VALUE_OFFSET] : undefined
  if (value) return value
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required argument ${name}.`)
}

function run() {
  const command = process.argv[CLI_COMMAND_INDEX]
  if (command !== 'verify') {
    throw new Error(`Unsupported app release-tree command: ${String(command)}.`)
  }

  const result = verifyGeneratedAppReleaseTree({
    candidateRef: argument('--candidate-ref'),
    projectRoot: path.resolve(argument('--root', process.cwd())),
    version: argument('--version'),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

try {
  run()
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
