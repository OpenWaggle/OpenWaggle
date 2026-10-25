import { describe, expect, it } from 'vitest'
import config from '../../electron-builder'
import { foreignNativePrebuildExclusions } from '../electron-builder-native-prebuilds'

const CONPTY = 'node_modules/**/node-pty/third_party/conpty'

describe('foreign native prebuild exclusions', () => {
  it('keeps only the packaged architecture of the bundled ConPTY on Windows', () => {
    expect(foreignNativePrebuildExclusions('win32')).toContain(`!${CONPTY}/*/!(win10-\${arch}){,/**/*}`)
    expect(foreignNativePrebuildExclusions('win32')).not.toContain(`!${CONPTY}{,/**/*}`)
  })

  it('drops the Windows-only ConPTY from macOS and Linux packs', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(foreignNativePrebuildExclusions(platform)).toContain(`!${CONPTY}{,/**/*}`)
    }
  })

  it('keys every other exclusion on the packaged platform and architecture macros', () => {
    const exclusions = foreignNativePrebuildExclusions('linux')
    expect(exclusions).toContain('!node_modules/**/onnxruntime-node/bin/napi-v6/!(${platform}){,/**/*}')
    expect(exclusions).toContain('!node_modules/**/better-sqlite3/prebuilds/!(${platform}-${arch}.node)')
    expect(exclusions).toContain(
      '!node_modules/**/onnxruntime-node/bin/napi-v6/linux/*/libonnxruntime_providers_{cuda,tensorrt}.so',
    )
  })

  it('keeps only the packaged architecture of per-platform packages such as sharp and keyring', () => {
    expect(foreignNativePrebuildExclusions('darwin')).toContain(
      '!node_modules/{*,@*/*}-${platform}-!(${arch}|${arch}-*){,/**/*}',
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
