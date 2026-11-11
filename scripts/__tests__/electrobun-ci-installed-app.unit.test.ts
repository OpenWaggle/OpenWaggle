import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { installedApp, installedVersion } from '../electrobun/ci/installed-app'

describe('installedApp', () => {
  it('finds the bundled Bun and app directory of a macOS bundle', () => {
    const app = installedApp('/Applications/OpenWaggle.app/Contents/MacOS/launcher', 'darwin')
    expect(app).toEqual({
      launcher: '/Applications/OpenWaggle.app/Contents/MacOS/launcher',
      installRoot: '/Applications/OpenWaggle.app',
      bun: '/Applications/OpenWaggle.app/Contents/MacOS/bun',
      appRoot: '/Applications/OpenWaggle.app/Contents/Resources/app',
      versionFile: '/Applications/OpenWaggle.app/Contents/Resources/version.json',
    })
  })

  it('finds them in an Electrobun install directory on Linux and Windows', () => {
    const root = '/home/runner/.local/share/com.openwaggle.app/stable/app'
    expect(installedApp(`${root}/bin/launcher`, 'linux')).toMatchObject({
      installRoot: root,
      bun: `${root}/bin/bun`,
      appRoot: `${root}/Resources/app`,
    })
    expect(installedApp(`${root}/bin/launcher.exe`, 'win32')).toMatchObject({
      installRoot: root,
      bun: `${root}/bin/bun.exe`,
    })
  })
})

describe('installedVersion', () => {
  it("reads Electrobun's version.json, or null without one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-app-'))
    const launcher = path.join(root, 'bin', 'launcher')
    const app = installedApp(launcher, 'linux')
    expect(installedVersion(app)).toBeNull()
    fs.mkdirSync(path.dirname(app.versionFile), { recursive: true })
    fs.writeFileSync(app.versionFile, JSON.stringify({ version: '1.0.0-beta.900' }))
    expect(installedVersion(app)).toBe('1.0.0-beta.900')
    fs.rmSync(root, { recursive: true, force: true })
  })
})
