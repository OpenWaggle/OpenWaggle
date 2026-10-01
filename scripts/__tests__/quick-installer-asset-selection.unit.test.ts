import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const RESOLUTION_START = '# BEGIN TESTABLE RELEASE RESOLUTION'
const RESOLUTION_END = '# END TESTABLE RELEASE RESOLUTION'
const DOWNLOAD_ROOT = 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.0.0-beta.3'
const DMG_CHECKSUM = 'af63f19fb7e200a7328eb7b48a8f31f80fc395f1df499aca5e71a0d4188ce6e9'
const BLOCKMAP_CHECKSUM = 'd8e5293746fb25e5b5ac5c9135a8f25ded3a45b4b51695adf0ef4e558208a2c9'

// The 1.0.0-beta.3 SHA256SUMS.txt shape: each installer is followed by its `.blockmap`, whose
// name extends the installer's. A substring lookup returned both hashes and failed every install.
const CHECKSUMS = `${DMG_CHECKSUM}  openwaggle-1.0.0-beta.3-arm64.dmg
${BLOCKMAP_CHECKSUM}  openwaggle-1.0.0-beta.3-arm64.dmg.blockmap
1111111111111111111111111111111111111111111111111111111111111111 *openwaggle-1.0.0-beta.3-x86_64.AppImage
`

function releaseJson(assetNames: readonly string[]) {
  const assets = assetNames.map(
    (name) => `    {\n      "name": "${name}",\n      "browser_download_url": "${DOWNLOAD_ROOT}/${name}"\n    }`,
  )
  return `{\n  "tag_name": "v1.0.0-beta.3",\n  "assets": [\n${assets.join(',\n')}\n  ]\n}`
}

async function runResolution(command: string, ...args: string[]) {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const start = source.indexOf(RESOLUTION_START)
  const end = source.indexOf(RESOLUTION_END)
  if (start < 0 || end <= start) throw new Error('Installer release resolution was not found.')
  const script = `set -euo pipefail\n${source.slice(start + RESOLUTION_START.length, end)}\n${command}`
  const { stdout } = await execFileAsync('bash', ['-c', script, 'installer-asset-test', ...args])
  return stdout.trim()
}

describe('quick installer asset selection', () => {
  it('reads the checksum of exactly the downloaded installer, not its blockmap', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-installer-sums-'))
    try {
      const checksumFile = path.join(directory, 'SHA256SUMS.txt')
      await fs.writeFile(checksumFile, CHECKSUMS)
      const lookup = 'expected_checksum "$1" "$2"'

      await expect(
        runResolution(lookup, checksumFile, 'openwaggle-1.0.0-beta.3-arm64.dmg'),
      ).resolves.toBe(DMG_CHECKSUM)
      await expect(
        runResolution(lookup, checksumFile, 'openwaggle-1.0.0-beta.3-x86_64.AppImage'),
      ).resolves.toBe('1111111111111111111111111111111111111111111111111111111111111111')
      await expect(runResolution(lookup, checksumFile, 'openwaggle-1.0.0-beta.3-x64.dmg')).resolves.toBe('')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('selects the installer even when GitHub lists its blockmap first', async () => {
    const json = releaseJson([
      'openwaggle-1.0.0-beta.3-arm64.dmg.blockmap',
      'openwaggle-1.0.0-beta.3-arm64.dmg',
      'openwaggle-1.0.0-beta.3-x86_64.AppImage.blockmap',
      'openwaggle-1.0.0-beta.3-x86_64.AppImage',
    ])
    const select = 'select_asset_url "$1" "$2"'

    await expect(runResolution(select, json, 'openwaggle-.*-arm64\\.dmg')).resolves.toBe(
      `${DOWNLOAD_ROOT}/openwaggle-1.0.0-beta.3-arm64.dmg`,
    )
    await expect(runResolution(select, json, 'openwaggle-.*-x86_64\\.AppImage')).resolves.toBe(
      `${DOWNLOAD_ROOT}/openwaggle-1.0.0-beta.3-x86_64.AppImage`,
    )
  })
})
