/**
 * The packaged smoke's run of scripts/pi-package-assets-probe.ts: Pi's HTML export and theme
 * loading on the copy of Pi's package directory that `app.asar` ships.
 */
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { type AsarArchive, readAsarArchive } from './asar-archive'

const execFile = promisify(execFileCallback)
const EXEC_MAX_BUFFER_BYTES = 10_000_000
/** Pi's package directory in `app.asar`, which the app points Pi at (`PI_PACKAGE_DIR`). */
const PI_PACKAGE_ASAR_DIRECTORY = '/node_modules/@earendil-works/pi-coding-agent/'
const PI_PACKAGE_ASSETS_PROBE = path.resolve(import.meta.dirname, 'pi-package-assets-probe.ts')
const PI_PACKAGE_ASSETS_PROBE_TIMEOUT_MS = 60_000

/**
 * Copies Pi's package directory out of `app.asar` into `target`, at the same path under
 * `node_modules`, so a probe outside Electron (which alone reads asar paths) can read it.
 */
export async function copyPiPackageOutOfAsar(
  archive: Pick<AsarArchive, 'files' | 'readFile'>,
  target: string,
) {
  let copied = 0
  for (const archivePath of archive.files.keys()) {
    if (!archivePath.startsWith(PI_PACKAGE_ASAR_DIRECTORY)) continue
    const file = path.join(target, ...archivePath.split('/'))
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, await archive.readFile(archivePath))
    copied += 1
  }
  return copied
}

/** Runs Pi's HTML export and theme loading on the packaged copy of Pi's package directory. */
export async function runPiPackageAssetsProbe(asarPath: string) {
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-packaged-pi-'))
  try {
    if ((await copyPiPackageOutOfAsar(await readAsarArchive(asarPath), copy)) === 0) {
      throw new Error(`${asarPath} has no ${PI_PACKAGE_ASAR_DIRECTORY}.`)
    }
    // The smoke runs on Bun, which runs the probe's TypeScript and Pi's code from the checkout.
    await execFile(process.execPath, [PI_PACKAGE_ASSETS_PROBE, copy], {
      cwd: process.cwd(),
      maxBuffer: EXEC_MAX_BUFFER_BYTES,
      timeout: PI_PACKAGE_ASSETS_PROBE_TIMEOUT_MS,
    })
  } finally {
    await fs.rm(copy, { recursive: true, force: true })
  }
}
