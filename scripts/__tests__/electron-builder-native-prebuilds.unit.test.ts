import { describe, expect, it } from 'vitest'
import config from '../../electron-builder'
import { foreignNativePrebuildExclusions } from '../electron-builder-native-prebuilds'

describe('foreign native prebuild exclusions', () => {
  it('keys every exclusion on the packaged platform and architecture macros', () => {
    const exclusions = foreignNativePrebuildExclusions()
    expect(exclusions).toContain(
      '!node_modules/**/onnxruntime-node/bin/napi-v6/!(${platform}){,/**/*}',
    )
    expect(exclusions).toContain(
      '!node_modules/**/better-sqlite3/prebuilds/!(${platform}-${arch}.node)',
    )
    expect(exclusions).toContain(
      '!node_modules/**/onnxruntime-node/bin/napi-v6/linux/*/libonnxruntime_providers_{cuda,tensorrt}.so',
    )
  })

  it('keeps only the packaged architecture of per-platform packages such as sharp and keyring', () => {
    expect(foreignNativePrebuildExclusions()).toContain(
      '!node_modules/{,**/node_modules/}{*,@*/*}-${platform}-!(${arch}|${arch}-*){,/**/*}',
    )
  })

  it('appends the exclusions to the top-level files list, after the inclusions they narrow', () => {
    const files = config.files
    const exclusions = foreignNativePrebuildExclusions()
    expect(files.slice(-exclusions.length)).toEqual(exclusions)
    expect(files.indexOf('node_modules/**/*')).toBeLessThan(files.length - exclusions.length)
    expect(config.mac).not.toHaveProperty('files')
    expect(config.linux).not.toHaveProperty('files')
    expect(config.win).not.toHaveProperty('files')
  })
})
