import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const INSTALLED_VERSION = '1.0.0-rc.1'
const INSTALLED_APPIMAGE = '#!/bin/sh\nprintf "appimage %s\\n" "$*" >> "$FAKE_CALLS"\n'
const DOWNLOADED_APPIMAGE = 'downloaded-appimage'
const RELEASES_API_URL = 'https://example.test/releases'

let directory = ''
let home = ''
let stubs = ''
let releases = ''
let appDirectory = ''

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'installer-downgrade-')))
  home = path.join(directory, 'home')
  stubs = path.join(directory, 'bin')
  releases = path.join(directory, 'releases')
  appDirectory = path.join(home, '.local', 'lib', 'openwaggle')
  await Promise.all([
    fs.mkdir(appDirectory, { recursive: true }),
    fs.mkdir(stubs, { recursive: true }),
    fs.mkdir(releases, { recursive: true }),
    fs.mkdir(path.join(directory, 'tmp'), { recursive: true }),
  ])
  await fs.writeFile(
    path.join(stubs, 'uname'),
    '#!/bin/sh\n[ "$1" = "-s" ] && echo "${FAKE_OS:-Linux}" || echo x86_64\n',
    { mode: 0o755 },
  )
  // Answers release lookups from files and records every request, so a test sees whether the
  // installer downloaded anything.
  await fs.writeFile(
    path.join(stubs, 'curl'),
    `#!/bin/sh
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
`,
    { mode: 0o755 },
  )
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

async function publish(tags: readonly string[]) {
  await fs.writeFile(
    path.join(releases, 'list.json'),
    JSON.stringify(tags.map((tag) => ({ tag_name: tag })), null, 2),
  )
  await Promise.all(
    tags.map((tag) =>
      fs.writeFile(
        path.join(releases, `${tag}.json`),
        JSON.stringify(
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
          2,
        ),
      ),
    ),
  )
}

async function installLinuxApp(version: string) {
  await fs.writeFile(path.join(appDirectory, 'OpenWaggle.AppImage'), INSTALLED_APPIMAGE, { mode: 0o755 })
  await fs.writeFile(path.join(appDirectory, 'version'), `${version}\n`)
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

async function runInstaller(env: Readonly<Record<string, string>>) {
  const result = await execFileAsync('bash', ['scripts/install.sh', '--no-launch'], {
    env: {
      PATH: `${stubs}:${process.env.PATH ?? ''}`,
      HOME: home,
      TMPDIR: path.join(directory, 'tmp'),
      FAKE_CALLS: path.join(directory, 'calls'),
      FAKE_RELEASES: releases,
      OPENWAGGLE_RELEASES_API_URL: RELEASES_API_URL,
      ...env,
    },
  }).catch((error: { stdout: string; stderr: string; code: number }) => error)
  return { ...result, exitCode: 'code' in result ? result.code : 0 }
}

async function calls() {
  return (await fs.readFile(path.join(directory, 'calls'), 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
}

async function expectInstallUnchanged() {
  await expect(fs.readFile(path.join(appDirectory, 'OpenWaggle.AppImage'), 'utf8')).resolves.toBe(
    INSTALLED_APPIMAGE,
  )
  await expect(fs.readFile(path.join(appDirectory, 'version'), 'utf8')).resolves.toBe(
    `${INSTALLED_VERSION}\n`,
  )
  await expect(fs.access(path.join(home, '.local', 'bin', 'openwaggle'))).rejects.toThrow()
  await expect(
    fs.access(path.join(home, '.config', 'openwaggle', 'install-update-channel')),
  ).rejects.toThrow()
  // Nothing was downloaded and the installed app never ran, so its Session Host was not stopped.
  const recorded = await calls()
  expect(recorded.filter((call) => call.includes(' -o '))).toEqual([])
  expect(recorded.filter((call) => call.startsWith('appimage'))).toEqual([])
}

describe('quick installer downgrade refusal', () => {
  it('refuses an exact older version before it downloads or stops anything', async () => {
    await publish(['v1.0.0-beta.37'])
    await installLinuxApp(INSTALLED_VERSION)

    const result = await runInstaller({ OPENWAGGLE_RELEASE_TAG: '1.0.0-beta.37' })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'OpenWaggle v1.0.0-beta.37 is older than the installed 1.0.0-rc.1. Downgrades are unsupported',
    )
    expect(result.stderr).toContain('OpenWaggle was not changed.')
    await expectInstallUnchanged()
  })

  it('refuses when the chosen channel only has an older release', async () => {
    await publish(['v1.0.0-beta.37', 'v0.4.0'])
    await installLinuxApp(INSTALLED_VERSION)

    const result = await runInstaller({ OPENWAGGLE_CHANNEL: 'stable' })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('OpenWaggle v0.4.0 is older than the installed 1.0.0-rc.1.')
    await expectInstallUnchanged()
  })

  // PlistBuddy, which reads the installed version from Info.plist, exists only on macOS.
  it.runIf(process.platform === 'darwin')(
    'refuses an older version on macOS before it downloads or quits the app',
    async () => {
      const applications = path.join(directory, 'Applications')
      await publish(['v1.0.0-beta.37'])
      await installMacApp(applications, INSTALLED_VERSION)

      const result = await runInstaller({
        FAKE_OS: 'Darwin',
        OPENWAGGLE_APPLICATIONS_DIR: applications,
        OPENWAGGLE_RELEASE_TAG: 'v1.0.0-beta.37',
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('is older than the installed 1.0.0-rc.1.')
      expect((await calls()).filter((call) => call.includes(' -o '))).toEqual([])
      await expect(fs.readdir(applications)).resolves.toEqual(['OpenWaggle.app'])
    },
  )

  it('reinstalls the installed version', async () => {
    await publish([`v${INSTALLED_VERSION}`])
    await installLinuxApp(INSTALLED_VERSION)

    const result = await runInstaller({ OPENWAGGLE_RELEASE_TAG: `v${INSTALLED_VERSION}` })

    expect(result.exitCode).toBe(0)
    await expect(fs.readFile(path.join(appDirectory, 'OpenWaggle.AppImage'), 'utf8')).resolves.toBe(
      DOWNLOADED_APPIMAGE,
    )
    expect(await calls()).toContain('appimage host --help')
  })

  it('upgrades to a newer version', async () => {
    await publish(['v1.0.0-rc.2', 'v1.0.0-beta.37'])
    await installLinuxApp(INSTALLED_VERSION)

    const result = await runInstaller({ OPENWAGGLE_CHANNEL: 'beta' })

    expect(result.exitCode).toBe(0)
    await expect(fs.readFile(path.join(appDirectory, 'version'), 'utf8')).resolves.toBe(
      '1.0.0-rc.2\n',
    )
  })
})
