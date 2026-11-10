import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect } from 'vitest'

const execFileAsync = promisify(execFile)
export const INSTALLED_VERSION = '1.0.0-rc.1'
// Records its calls. Like a real AppImage it extracts its desktop entry, with the version the test
// embeds, and prints its `update --check --json` response to descriptor 3 when the test gives one.
const INSTALLED_APPIMAGE = `#!/bin/sh
printf "appimage %s\\n" "$*" >> "$FAKE_CALLS"
if [ "$1" = "--appimage-extract" ] && [ -f "$FAKE_EMBEDDED_VERSION" ]; then
  mkdir -p squashfs-root
  printf '[Desktop Entry]\\nName=OpenWaggle\\nX-AppImage-Version=%s\\n' "$(cat "$FAKE_EMBEDDED_VERSION")" > squashfs-root/openwaggle.desktop
fi
if [ "$*" = "update --check --json" ] && [ -f "$FAKE_CHANNEL_RESPONSE" ]; then cat "$FAKE_CHANNEL_RESPONSE" >&3; fi
`
const APPIMAGE_EXTRACT_CALL = 'appimage --appimage-extract *.desktop'
export const DOWNLOADED_APPIMAGE = 'downloaded-appimage'
const RELEASES_API_URL = 'https://example.test/releases'
const EXECUTABLE_MODE = 0o755
const JSON_INDENT_SPACES = 2
const CHANNEL_INTENT = ['.config', 'openwaggle', 'install-update-channel'] as const

interface HarnessPaths {
  readonly directory: string
  readonly home: string
  readonly stubs: string
  readonly releases: string
  readonly appDirectory: string
}

// Answers release lookups from files and records every request, so a test sees whether the
// installer downloaded anything.
const FAKE_CURL = `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$FAKE_CALLS"
output=''
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; fi
  previous="$argument"
  url="$argument"
done
if [ -n "$output" ]; then printf '${DOWNLOADED_APPIMAGE}' > "$output"; exit 0; fi
case "$url" in
  */releases/tags/*) cat "$FAKE_RELEASES/\${url##*/}.json" ;;
  *page=1) cat "$FAKE_RELEASES/list.json" ;;
  *) printf '[]' ;;
esac
`
const FAKE_UNAME = '#!/bin/sh\n[ "$1" = "-s" ] && echo "${FAKE_OS:-Linux}" || echo x86_64\n'

async function createPaths(): Promise<HarnessPaths> {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'installer-reinstall-')),
  )
  const home = path.join(directory, 'home')
  const paths = {
    directory,
    home,
    stubs: path.join(directory, 'bin'),
    releases: path.join(directory, 'releases'),
    appDirectory: path.join(home, '.local', 'lib', 'openwaggle'),
  }
  await Promise.all([
    fs.mkdir(paths.appDirectory, { recursive: true }),
    fs.mkdir(paths.stubs, { recursive: true }),
    fs.mkdir(paths.releases, { recursive: true }),
    fs.mkdir(path.join(directory, 'tmp'), { recursive: true }),
  ])
  await fs.writeFile(path.join(paths.stubs, 'uname'), FAKE_UNAME, { mode: EXECUTABLE_MODE })
  await fs.writeFile(path.join(paths.stubs, 'curl'), FAKE_CURL, { mode: EXECUTABLE_MODE })
  return paths
}

function releaseJson(tag: string) {
  return JSON.stringify(
    {
      tag_name: tag,
      assets: [
        {
          browser_download_url: `https://example.test/download/${tag}/openwaggle-${tag.slice(1)}-x86_64.AppImage`,
        },
        // Every release lists checksums; the fake download leaves this one without entries.
        { browser_download_url: `https://example.test/download/${tag}/SHA256SUMS.txt` },
      ],
    },
    null,
    JSON_INDENT_SPACES,
  )
}

async function publish(paths: HarnessPaths, tags: readonly string[]) {
  const list = JSON.stringify(
    tags.map((tag) => ({ tag_name: tag })),
    null,
    JSON_INDENT_SPACES,
  )
  await fs.writeFile(path.join(paths.releases, 'list.json'), list)
  await Promise.all(
    tags.map((tag) => fs.writeFile(path.join(paths.releases, `${tag}.json`), releaseJson(tag))),
  )
}

async function installLinuxApp(paths: HarnessPaths, version: string) {
  await fs.writeFile(path.join(paths.appDirectory, 'OpenWaggle.AppImage'), INSTALLED_APPIMAGE, {
    mode: EXECUTABLE_MODE,
  })
  await fs.writeFile(path.join(paths.appDirectory, 'version'), `${version}\n`)
}

async function installMacApp(applications: string, version: string) {
  const contents = path.join(applications, 'OpenWaggle.app', 'Contents')
  await fs.mkdir(contents, { recursive: true })
  await fs.writeFile(
    path.join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>
`,
  )
}

/** What the installed app's `openwaggle update --check --json` prints, in the CLI's own format. */
async function reportSavedChannel(paths: HarnessPaths, savedChannel: string) {
  const response = {
    schemaVersion: 1,
    type: 'response',
    command: 'update',
    result: { savedChannel, channel: savedChannel, status: 'up-to-date' },
  }
  await fs.writeFile(
    path.join(paths.directory, 'channel-response.json'),
    `${JSON.stringify(response, null, JSON_INDENT_SPACES)}\n`,
  )
}

async function runInstaller(paths: HarnessPaths, env: Readonly<Record<string, string>>) {
  const result = await execFileAsync('bash', ['scripts/install.sh', '--no-launch'], {
    env: {
      PATH: `${paths.stubs}:${process.env.PATH ?? ''}`,
      HOME: paths.home,
      TMPDIR: path.join(paths.directory, 'tmp'),
      FAKE_CALLS: path.join(paths.directory, 'calls'),
      FAKE_RELEASES: paths.releases,
      FAKE_CHANNEL_RESPONSE: path.join(paths.directory, 'channel-response.json'),
      FAKE_EMBEDDED_VERSION: path.join(paths.directory, 'embedded-version'),
      OPENWAGGLE_RELEASES_API_URL: RELEASES_API_URL,
      ...env,
    },
  }).catch((error: { stdout: string; stderr: string; code: number }) => error)
  return { ...result, exitCode: 'code' in result ? result.code : 0 }
}

async function calls(paths: HarnessPaths) {
  return (await fs.readFile(path.join(paths.directory, 'calls'), 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
}

async function expectInstallUnchanged(paths: HarnessPaths) {
  await expect(
    fs.readFile(path.join(paths.appDirectory, 'OpenWaggle.AppImage'), 'utf8'),
  ).resolves.toBe(INSTALLED_APPIMAGE)
  await expect(fs.readFile(path.join(paths.appDirectory, 'version'), 'utf8')).resolves.toBe(
    `${INSTALLED_VERSION}\n`,
  )
  await expect(fs.access(path.join(paths.home, '.local', 'bin', 'openwaggle'))).rejects.toThrow()
  await expect(fs.access(path.join(paths.home, ...CHANNEL_INTENT))).rejects.toThrow()
  // Nothing was downloaded and the installed app never ran, so its Session Host was not stopped.
  const recorded = await calls(paths)
  expect(recorded.filter((call) => call.includes(' -o '))).toEqual([])
  // Reading its desktop entry runs nothing from the app.
  expect(
    recorded.filter((call) => call.startsWith('appimage') && call !== APPIMAGE_EXTRACT_CALL),
  ).toEqual([])
}

/**
 * Runs the whole `install.sh` against a fake Linux (or macOS) home with stubbed `uname` and `curl`
 * and a fake installed AppImage. Registers its own setup and cleanup hooks.
 */
export function useInstallerHarness() {
  let current: HarnessPaths | undefined
  const paths = () => {
    if (!current) throw new Error('The installer harness is used outside a test.')
    return current
  }
  beforeEach(async () => {
    current = await createPaths()
  })
  afterEach(async () => {
    if (current) await fs.rm(current.directory, { recursive: true, force: true })
    current = undefined
  })
  return {
    appDirectory: () => paths().appDirectory,
    directory: () => paths().directory,
    publish: (tags: readonly string[]) => publish(paths(), tags),
    installLinuxApp: (version: string) => installLinuxApp(paths(), version),
    installMacApp,
    reportSavedChannel: (channel: string) => reportSavedChannel(paths(), channel),
    savedChannelIntent: () =>
      fs.readFile(path.join(paths().home, ...CHANNEL_INTENT), 'utf8').catch(() => null),
    installedVersion: async () =>
      (await fs.readFile(path.join(paths().appDirectory, 'version'), 'utf8')).trim(),
    runInstaller: (env: Readonly<Record<string, string>>) => runInstaller(paths(), env),
    calls: () => calls(paths()),
    expectInstallUnchanged: () => expectInstallUnchanged(paths()),
  }
}
