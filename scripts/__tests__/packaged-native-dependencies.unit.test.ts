import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAsarArchive } from '../asar-archive'
import { isNativePackageFor, missingNativeDependencies } from '../packaged-native-dependencies'
import { asarImage, packageJson } from './asar-fixtures'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function archive(files: Record<string, string>, unpacked: readonly string[] = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-native-'))
  temporaryRoots.push(root)
  const asarPath = path.join(root, 'app.asar')
  await fs.writeFile(asarPath, asarImage(files, unpacked))
  for (const file of unpacked) {
    await fs.mkdir(path.dirname(path.join(`${asarPath}.unpacked`, file)), { recursive: true })
    await fs.writeFile(path.join(`${asarPath}.unpacked`, file), files[file] ?? '')
  }
  return readAsarArchive(asarPath)
}

const SHARP = ['@img/sharp-darwin-arm64', '@img/sharp-darwin-x64', '@img/sharp-linux-x64', '@img/sharp-linuxmusl-x64']
const KEYRING = ['@napi-rs/keyring-darwin-x64', '@napi-rs/keyring-linux-x64-gnu', '@napi-rs/keyring-linux-x64-musl']

describe('readAsarArchive', () => {
  it('lists packed and unpacked files and reads both', async () => {
    const asar = await archive(
      { 'package.json': '{"name":"app"}', 'node_modules/a/index.js': 'module.exports = 1' },
      ['node_modules/a/index.js'],
    )
    expect([...asar.files.keys()]).toEqual(['/package.json', '/node_modules/a/index.js'])
    expect((await asar.readFile('/package.json')).toString()).toBe('{"name":"app"}')
    expect((await asar.readFile('/node_modules/a/index.js')).toString()).toBe('module.exports = 1')
  })
})

describe('isNativePackageFor', () => {
  it('matches the per-platform package for the target, glibc and MSVC builds included', () => {
    expect(isNativePackageFor('@img/sharp-darwin-x64', 'darwin', 'x64')).toBe(true)
    expect(isNativePackageFor('@napi-rs/keyring-linux-x64-gnu', 'linux', 'x64')).toBe(true)
    expect(isNativePackageFor('@mariozechner/clipboard-win32-x64-msvc', 'win32', 'x64')).toBe(true)
    expect(isNativePackageFor('@img/sharp-darwin-arm64', 'darwin', 'x64')).toBe(false)
    expect(isNativePackageFor('@napi-rs/keyring-linux-x64-musl', 'linux', 'x64')).toBe(false)
    expect(isNativePackageFor('@img/sharp-linuxmusl-x64', 'linux', 'x64')).toBe(false)
    expect(isNativePackageFor('@mariozechner/clipboard-darwin-universal', 'darwin', 'x64')).toBe(false)
  })
})

describe('missingNativeDependencies', () => {
  it('fails the Intel app that shipped only the arm64 sharp and keyring builds', async () => {
    const asar = await archive({
      'package.json': packageJson('openwaggle', ['@img/sharp-darwin-arm64', '@img/sharp-darwin-x64']),
      'node_modules/sharp/package.json': packageJson('sharp', SHARP),
      'node_modules/@img/sharp-darwin-arm64/package.json': packageJson('@img/sharp-darwin-arm64'),
      'node_modules/@napi-rs/keyring/package.json': packageJson('@napi-rs/keyring', KEYRING),
    })
    expect(await missingNativeDependencies(asar, 'darwin', 'x64')).toEqual([
      '@img/sharp-darwin-x64, which the app needs on darwin-x64, is not in the app',
      '@napi-rs/keyring-darwin-x64, which @napi-rs/keyring needs on darwin-x64, is not in the app',
    ])
    expect(await missingNativeDependencies(asar, 'darwin', 'arm64')).toEqual([])
  })

  it('passes when every per-platform package for the target ships, even nested or unpacked', async () => {
    const asar = await archive(
      {
        'node_modules/@napi-rs/keyring/package.json': packageJson('@napi-rs/keyring', KEYRING),
        'node_modules/a/node_modules/@napi-rs/keyring-linux-x64-gnu/package.json': packageJson('x'),
        'node_modules/sharp/package.json': packageJson('sharp', SHARP),
        'node_modules/@img/sharp-linux-x64/package.json': packageJson('@img/sharp-linux-x64'),
      },
      ['node_modules/@img/sharp-linux-x64/package.json'],
    )
    expect(await missingNativeDependencies(asar, 'linux', 'x64')).toEqual([])
  })
})
