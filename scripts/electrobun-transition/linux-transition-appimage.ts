/**
 * Builds the Linux transition AppImage (build/electrobun-transition/AppRun.sh): an AppImage that
 * electron-updater swaps in for the Electron AppImage and starts, and whose AppRun installs the
 * Electrobun app from Electrobun's `*-Setup.tar.gz` (docs/electrobun-transition.md).
 *
 *   bun scripts/electrobun-transition/linux-transition-appimage.ts \
 *     <Electrobun Setup.tar.gz> <out openwaggle-<version>-x86_64.AppImage> <version> <stable|canary> <appimagetool>
 */
import { execFile } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ARGUMENT_OFFSET = 2
const EXECUTABLE_MODE = 0o755
const MAX_BUFFER_BYTES = 16 * 1024 * 1024
const BUILD_DIRECTORY = path.join(import.meta.dirname, '..', '..', 'build')
const INSTALLER_DIRECTORY = path.join('usr', 'lib', 'openwaggle-transition')

export function renderAppRun(
  template: string,
  values: { readonly identifier: string; readonly channel: string; readonly version: string },
) {
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`Unsafe AppRun ${name}: ${value}`)
  }
  return template
    .replaceAll('@IDENTIFIER@', values.identifier)
    .replaceAll('@CHANNEL@', values.channel)
    .replaceAll('@VERSION@', values.version)
}

/** install.sh reads X-AppImage-Version from the embedded entry for its downgrade guard. */
export function transitionDesktopEntry(version: string) {
  return [
    '[Desktop Entry]',
    'Name=OpenWaggle',
    'Comment=Desktop coding agent with multi-model support',
    'Exec=AppRun %U',
    'Icon=openwaggle',
    'Type=Application',
    'Categories=Development;',
    'MimeType=x-scheme-handler/openwaggle;',
    `X-AppImage-Version=${version}`,
    '',
  ].join('\n')
}

export async function buildLinuxTransitionAppImage(input: {
  readonly setupArchive: string
  readonly outFile: string
  readonly version: string
  readonly electrobunChannel: string
  readonly appimagetool: string
  readonly identifier?: string
}) {
  const appDir = await mkdtemp(path.join(tmpdir(), 'openwaggle-transition-appdir-'))
  try {
    const installerDirectory = path.join(appDir, INSTALLER_DIRECTORY)
    await mkdir(installerDirectory, { recursive: true })
    await run('tar', ['-xzf', input.setupArchive, '-C', installerDirectory])
    const entries = await readdir(installerDirectory, { recursive: true })
    const installer = entries.find((entry) => path.basename(entry) === 'installer')
    if (!installer) throw new Error(`${input.setupArchive} has no Electrobun installer.`)
    if (installer !== 'installer') {
      // AppRun runs usr/lib/openwaggle-transition/installer; the archive may nest it in a folder.
      await rename(
        path.join(installerDirectory, installer),
        path.join(installerDirectory, 'installer'),
      )
    }
    const template = await readFile(
      path.join(BUILD_DIRECTORY, 'electrobun-transition', 'AppRun.sh'),
      'utf8',
    )
    const appRun = path.join(appDir, 'AppRun')
    await writeFile(
      appRun,
      renderAppRun(template, {
        identifier: input.identifier ?? 'com.openwaggle.app',
        channel: input.electrobunChannel,
        version: input.version,
      }),
    )
    await chmod(appRun, EXECUTABLE_MODE)
    await writeFile(path.join(appDir, 'openwaggle.desktop'), transitionDesktopEntry(input.version))
    await copyFile(path.join(BUILD_DIRECTORY, 'icon.png'), path.join(appDir, 'openwaggle.png'))
    // mkdtemp creates 0700; every user who runs the AppImage must read and traverse its files.
    await run('chmod', ['-R', 'a+rX', appDir])
    await rm(input.outFile, { force: true })
    const { stdout, stderr } = await run(
      input.appimagetool,
      ['--no-appstream', appDir, input.outFile],
      {
        env: { ...process.env, ARCH: 'x86_64' },
        maxBuffer: MAX_BUFFER_BYTES,
        encoding: 'utf8',
      },
    )
    return { outFile: input.outFile, log: `${stdout}${stderr}` }
  } finally {
    await rm(appDir, { recursive: true, force: true })
  }
}

async function main() {
  const [setupArchive, outFile, version, electrobunChannel, appimagetool] =
    process.argv.slice(ARGUMENT_OFFSET)
  if (!setupArchive || !outFile || !version || !electrobunChannel || !appimagetool) {
    throw new Error(
      'Usage: linux-transition-appimage.ts <Setup.tar.gz> <out.AppImage> <version> <stable|canary> <appimagetool>',
    )
  }
  await buildLinuxTransitionAppImage({
    setupArchive: path.resolve(setupArchive),
    outFile: path.resolve(outFile),
    version,
    electrobunChannel,
    appimagetool,
  })
  process.stdout.write(`${outFile}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
