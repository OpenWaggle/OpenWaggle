import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SCRIPT_DIRECTORY = dirname(SCRIPT_PATH)
const PROJECT_ROOT = join(SCRIPT_DIRECTORY, '..')
const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'
const MODE_ARG_INDEX = 2

type RebuildMode = 'node' | 'electron'

function isRebuildMode(value: string | undefined): value is RebuildMode {
  return value === 'node' || value === 'electron'
}

function runCommand(
  command: string,
  args: readonly string[],
  extraEnvironment: NodeJS.ProcessEnv = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        ...extraEnvironment,
      },
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}`))
    })
  })
}

async function getElectronVersion(): Promise<string> {
  const packageJsonPath = join(PROJECT_ROOT, 'node_modules', 'electron', 'package.json')
  const packageJsonText = await readFile(packageJsonPath, 'utf8')
  const packageJson: unknown = JSON.parse(packageJsonText)

  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    !('version' in packageJson) ||
    typeof packageJson.version !== 'string' ||
    packageJson.version.length === 0
  ) {
    throw new Error('Unable to determine installed Electron version for native dependency rebuild.')
  }

  return packageJson.version
}

async function rebuildForNode(): Promise<void> {
  await runCommand('pnpm', ['rebuild', 'better-sqlite3'])
}

async function rebuildForElectron(): Promise<void> {
  await runCommand('pnpm', ['exec', 'electron-builder', 'install-app-deps'])

  const electronVersion = await getElectronVersion()
  await runCommand('pnpm', ['rebuild', 'better-sqlite3'], {
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_disturl: ELECTRON_HEADERS_URL,
  })
}

async function main(): Promise<void> {
  const mode = process.argv[MODE_ARG_INDEX]

  if (!isRebuildMode(mode)) {
    throw new Error('Usage: pnpm tsx scripts/rebuild-native-deps.ts <node|electron>')
  }

  if (mode === 'node') {
    await rebuildForNode()
    return
  }

  await rebuildForElectron()
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
