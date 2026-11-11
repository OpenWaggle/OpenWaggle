/**
 * Prepares the Electrobun `OpenWaggle.app` for the one update Squirrel.Mac applies to it, before
 * it is signed (docs/electrobun-transition.md, "macOS"). Run it from the Electrobun `postBuild`
 * hook on macOS, on the app bundle that is then signed, zipped and published.
 *
 * Squirrel.Mac (ShipIt) in the Electron build being replaced does two things the stock Electrobun
 * bundle does not survive, both seen in the transition bench:
 * - it installs the update as `<CFBundleExecutable>.app`, so Electrobun's `launcher` executable
 *   turned `/Applications/OpenWaggle.app` into `/Applications/launcher.app`;
 * - on macOS 11 and later it relaunches through `Contents/Frameworks/Squirrel.framework/Resources/
 *   ShipIt` inside the new bundle, which Electrobun has no reason to ship.
 * So the executable becomes `OpenWaggle` (also the path the `openwaggle` CLI shim from install.sh
 * runs), and a minimal `Squirrel.framework` carries build/electrobun-transition/squirrel-relaunch.c.
 * `Contents/MacOS/launcher` stays as a copy: Electrobun's own updater refuses an update whose bundle
 * lacks it (`prepare_update.zig` opens `Contents/MacOS/launcher`), and every later release ships the
 * same prepared bundle.
 *
 *   bun scripts/electrobun-transition/macos-transition-bundle.ts <OpenWaggle.app>
 */
import { execFile } from 'node:child_process'
import { chmod, copyFile, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { CommandRunner } from './macos-transition-zip'

const run = promisify(execFile)
const ARGUMENT_OFFSET = 2
const EXECUTABLE_MODE = 0o755
export const TRANSITION_EXECUTABLE_NAME = 'OpenWaggle'
const MINIMUM_MACOS = '11.0'
const RELAUNCH_SOURCE = path.join(
  import.meta.dirname,
  '..',
  '..',
  'build',
  'electrobun-transition',
  'squirrel-relaunch.c',
)

const defaultRunner: CommandRunner = (command, args) =>
  run(command, [...args], { encoding: 'utf8' })

export function squirrelFrameworkInfoPlist(bundleId: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Squirrel</string>
  <key>CFBundleIdentifier</key><string>${bundleId}.squirrel-relaunch</string>
  <key>CFBundleName</key><string>Squirrel</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
</dict>
</plist>
`
}

export interface MacosTransitionBundleInput {
  readonly app: string
  readonly bundleId?: string
  readonly runner?: CommandRunner
}

/**
 * Makes `OpenWaggle` (a copy of the previous executable, which stays) the bundle executable and
 * returns the previous name.
 */
async function renameExecutable(app: string, runner: CommandRunner) {
  const plist = path.join(app, 'Contents', 'Info.plist')
  const { stdout } = await runner('plutil', ['-extract', 'CFBundleExecutable', 'raw', plist])
  const previous = stdout.trim()
  if (previous !== TRANSITION_EXECUTABLE_NAME) {
    const macos = path.join(app, 'Contents', 'MacOS')
    const source = path.join(macos, previous)
    const target = path.join(macos, TRANSITION_EXECUTABLE_NAME)
    await copyFile(source, target)
    await chmod(target, (await stat(source)).mode)
    await runner('plutil', [
      '-replace',
      'CFBundleExecutable',
      '-string',
      TRANSITION_EXECUTABLE_NAME,
      plist,
    ])
  }
  return previous
}

async function addSquirrelRelauncher(app: string, bundleId: string, runner: CommandRunner) {
  const framework = path.join(app, 'Contents', 'Frameworks', 'Squirrel.framework')
  await rm(framework, { recursive: true, force: true })
  const version = path.join(framework, 'Versions', 'A')
  const resources = path.join(version, 'Resources')
  await mkdir(resources, { recursive: true })
  const shipIt = path.join(resources, 'ShipIt')
  await runner('clang', [
    '-O2',
    '-arch',
    'arm64',
    '-arch',
    'x86_64',
    `-mmacosx-version-min=${MINIMUM_MACOS}`,
    '-o',
    shipIt,
    RELAUNCH_SOURCE,
  ])
  await chmod(shipIt, EXECUTABLE_MODE)
  // A framework is signed through its main binary; the relauncher doubles as it.
  await runner('cp', [shipIt, path.join(version, 'Squirrel')])
  await writeFile(path.join(resources, 'Info.plist'), squirrelFrameworkInfoPlist(bundleId))
  await symlink('A', path.join(framework, 'Versions', 'Current'))
  await symlink('Versions/Current/Squirrel', path.join(framework, 'Squirrel'))
  await symlink('Versions/Current/Resources', path.join(framework, 'Resources'))
}

export async function prepareMacosTransitionBundle(input: MacosTransitionBundleInput) {
  const runner = input.runner ?? defaultRunner
  if (path.extname(input.app) !== '.app') throw new Error(`${input.app} is not an app bundle.`)
  const previousExecutable = await renameExecutable(input.app, runner)
  await addSquirrelRelauncher(input.app, input.bundleId ?? 'com.openwaggle.app', runner)
  return { previousExecutable }
}

async function main() {
  const [app] = process.argv.slice(ARGUMENT_OFFSET)
  if (!app) throw new Error('Usage: macos-transition-bundle.ts <OpenWaggle.app>')
  const { previousExecutable } = await prepareMacosTransitionBundle({ app: path.resolve(app) })
  process.stdout.write(`${app}: ${previousExecutable} -> ${TRANSITION_EXECUTABLE_NAME}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
