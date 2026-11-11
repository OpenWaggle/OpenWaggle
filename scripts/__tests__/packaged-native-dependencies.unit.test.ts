import { describe, expect, it } from 'vitest'
import { isNativePackageFor, missingNativeDependencies } from '../packaged-native-dependencies'
import { appFiles, packageJson } from './packaged-app-fixtures'

const SHARP = [
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-linux-x64',
  '@img/sharp-linuxmusl-x64',
]
const KEYRING = [
  '@napi-rs/keyring-darwin-x64',
  '@napi-rs/keyring-linux-x64-gnu',
  '@napi-rs/keyring-linux-x64-musl',
]

describe('isNativePackageFor', () => {
  it('matches the per-platform package for the target, glibc and MSVC builds included', () => {
    expect(isNativePackageFor('@img/sharp-darwin-x64', 'darwin', 'x64')).toBe(true)
    expect(isNativePackageFor('@napi-rs/keyring-linux-x64-gnu', 'linux', 'x64')).toBe(true)
    expect(isNativePackageFor('@mariozechner/clipboard-win32-x64-msvc', 'win32', 'x64')).toBe(true)
    expect(isNativePackageFor('@img/sharp-darwin-arm64', 'darwin', 'x64')).toBe(false)
    expect(isNativePackageFor('@napi-rs/keyring-linux-x64-musl', 'linux', 'x64')).toBe(false)
    expect(isNativePackageFor('@img/sharp-linuxmusl-x64', 'linux', 'x64')).toBe(false)
    expect(isNativePackageFor('@mariozechner/clipboard-darwin-universal', 'darwin', 'x64')).toBe(
      false,
    )
  })
})

describe('missingNativeDependencies', () => {
  it('fails the Intel app that shipped only the arm64 sharp and keyring builds', async () => {
    const app = appFiles({
      'package.json': packageJson('openwaggle', [
        '@img/sharp-darwin-arm64',
        '@img/sharp-darwin-x64',
      ]),
      'node_modules/sharp/package.json': packageJson('sharp', SHARP),
      'node_modules/@img/sharp-darwin-arm64/package.json': packageJson('@img/sharp-darwin-arm64'),
      'node_modules/@napi-rs/keyring/package.json': packageJson('@napi-rs/keyring', KEYRING),
    })
    expect(await missingNativeDependencies(app, 'darwin', 'x64')).toEqual([
      '@img/sharp-darwin-x64, which the app needs on darwin-x64, is not in the app',
      '@napi-rs/keyring-darwin-x64, which @napi-rs/keyring needs on darwin-x64, is not in the app',
    ])
    expect(await missingNativeDependencies(app, 'darwin', 'arm64')).toEqual([])
  })

  it('passes when every per-platform package for the target ships, even nested', async () => {
    const app = appFiles({
      'node_modules/@napi-rs/keyring/package.json': packageJson('@napi-rs/keyring', KEYRING),
      'node_modules/a/node_modules/@napi-rs/keyring-linux-x64-gnu/package.json': packageJson('x'),
      'node_modules/sharp/package.json': packageJson('sharp', SHARP),
      'node_modules/@img/sharp-linux-x64/package.json': packageJson('@img/sharp-linux-x64'),
    })
    expect(await missingNativeDependencies(app, 'linux', 'x64')).toEqual([])
  })
})
