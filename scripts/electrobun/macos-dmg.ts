/**
 * The macOS DMG for new installs (install.sh and the website download), built from the same
 * signed, stapled app the update archive and the transition zip carry. Electrobun's own DMG would
 * hold its self-extracting wrapper instead; shipping the real bundle means one signature, one
 * notarization and no first-launch extraction inside `/Applications`.
 *
 * hdiutil fails now and then on hosted runners with a device error under concurrent disk activity
 * (release-and-ci memory, actions/runner-images#7522), so `create` is retried. With a signing
 * identity the DMG is signed, and with Apple credentials notarized and stapled, as electron-builder
 * did for the Electron DMG.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { notarizeMacos, notaryCredentials } from './notarize-macos'

const CREATE_ATTEMPTS = 3

export interface MacosDmgOptions {
  readonly app: string
  readonly output: string
  readonly environment: NodeJS.ProcessEnv
}

function createImage(source: string, volumeName: string, output: string) {
  for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt += 1) {
    try {
      fs.rmSync(output, { force: true })
      execFileSync('hdiutil', [
        'create',
        '-volname',
        volumeName,
        '-srcfolder',
        source,
        '-fs',
        'HFS+',
        '-format',
        'ULFO',
        '-ov',
        output,
      ])
      return
    } catch (error) {
      if (attempt === CREATE_ATTEMPTS) throw error
      console.warn(`hdiutil create failed (attempt ${attempt}); retrying.`)
    }
  }
}

export async function createMacosDmg(options: MacosDmgOptions) {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-dmg-'))
  try {
    execFileSync('ditto', [options.app, path.join(source, path.basename(options.app))])
    fs.symlinkSync('/Applications', path.join(source, 'Applications'))
    createImage(source, path.basename(options.app, '.app'), options.output)
  } finally {
    fs.rmSync(source, { recursive: true, force: true })
  }
  const identity = options.environment['OPENWAGGLE_MACOS_SIGN_IDENTITY'] ?? ''
  if (identity === '') return
  const keychain = options.environment['OPENWAGGLE_MACOS_SIGN_KEYCHAIN'] ?? ''
  execFileSync('codesign', [
    '--force',
    '--sign',
    identity,
    ...(keychain === '' ? [] : ['--keychain', keychain]),
    options.environment['OPENWAGGLE_MACOS_SIGN_TIMESTAMP'] === '0'
      ? '--timestamp=none'
      : '--timestamp',
    options.output,
  ])
  const credentials = notaryCredentials(options.environment)
  if (credentials !== null) await notarizeMacos(options.output, credentials)
}
