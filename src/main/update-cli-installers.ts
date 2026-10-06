import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { app } from 'electron'
import { launchExternalApplication } from './desktop-ui'
import { getEnvWithOverrides } from './env'

const INSTALLER_FAILURE_EXIT_CODE = 1
const WINDOWS_INSTALLER_MODE = 0o700
const releaseSchema = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(Schema.Struct({ name: Schema.String, browser_download_url: Schema.String })),
})

export async function releaseForTag(tag: string) {
  const response = await fetch(
    `https://api.github.com/repos/OpenWaggle/OpenWaggle/releases/tags/${encodeURIComponent(tag)}`,
    { headers: { accept: 'application/vnd.github+json' } },
  )
  if (!response.ok) throw new Error(`OpenWaggle release ${tag} was not found.`)
  return decodeUnknownOrThrow(releaseSchema, await response.json())
}

/** Installs an exact release through the bundled shell installer without opening the app. */
export async function runBundledInstaller(tag: string) {
  const installerPath = app.isPackaged
    ? path.join(process.resourcesPath, 'openwaggle-install.sh')
    : path.join(app.getAppPath(), 'scripts', 'install.sh')
  // Ctrl-C reaches the installer too, which cancels and restores the app; this process must not
  // quit first with status 0, so the installer's own status is the result.
  const holdQuit = (event: Electron.Event) => event.preventDefault()
  app.on('before-quit', holdQuit)
  try {
    return await new Promise<number>((resolve, reject) => {
      // A terminal update runs with the desktop app closed and must not open a window.
      const child = spawn('bash', [installerPath], {
        stdio: 'inherit',
        env: getEnvWithOverrides({ OPENWAGGLE_RELEASE_TAG: tag, OPENWAGGLE_NO_LAUNCH: '1' }),
      })
      child.once('error', reject)
      child.once('exit', (code) => resolve(code ?? INSTALLER_FAILURE_EXIT_CODE))
    })
  } finally {
    app.off('before-quit', holdQuit)
  }
}

async function download(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`)
  return Buffer.from(await response.arrayBuffer())
}

/** Downloads and verifies the NSIS installer; returns a launcher, so nothing stops until it is ready. */
export async function prepareWindowsInstaller(tag: string) {
  const release = await releaseForTag(tag)
  const installer = release.assets.find((asset) => /-x64\.exe$/u.test(asset.name))
  const checksums = release.assets.find((asset) => asset.name === 'SHA256SUMS.txt')
  if (!installer || !checksums)
    throw new Error(`Release ${tag} is missing Windows verification assets.`)
  const [contents, checksumContents] = await Promise.all([
    download(installer.browser_download_url),
    download(checksums.browser_download_url),
  ])
  const expected = checksumContents
    .toString('utf8')
    .split('\n')
    .find((line) => line.trimEnd().endsWith(` ${installer.name}`))
    ?.trim()
    .split(/\s+/u)[0]
  const actual = createHash('sha256').update(contents).digest('hex')
  if (!expected || expected !== actual)
    throw new Error(`Release ${tag} failed checksum verification.`)
  const destination = path.join(tmpdir(), `openwaggle-update-${randomUUID()}.exe`)
  await writeFile(destination, contents, { mode: WINDOWS_INSTALLER_MODE })
  return { launch: () => launchExternalApplication(destination, ['/S']) }
}
