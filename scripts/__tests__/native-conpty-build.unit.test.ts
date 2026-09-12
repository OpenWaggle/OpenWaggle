import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ConPTY source-build payload', () => {
  it('copies bundled console binaries during compilation without relying on postinstall', async () => {
    const packageRoot = path.resolve('node_modules/node-pty')
    const configuration = await fs.readFile(path.join(packageRoot, 'binding.gyp'), 'utf8')
    const conptyTarget = configuration.split("'target_name': 'conpty',")[1]?.split("'target_name':")[0]

    expect(conptyTarget).toContain("'copies':")
    expect(conptyTarget).toContain("'destination': '<(PRODUCT_DIR)/conpty'")
    expect(conptyTarget).toContain('target_arch=="x64" or target_arch=="arm64"')

    const versions = await fs.readdir(path.join(packageRoot, 'third_party/conpty'))
    expect(versions).toHaveLength(1)
    for (const file of ['conpty.dll', 'OpenConsole.exe']) {
      expect(conptyTarget).toContain(`third_party/conpty/${versions[0]}/win10-<(target_arch)/${file}`)
      for (const arch of ['x64', 'arm64']) {
        const bytes = await fs.readFile(path.join(packageRoot, `third_party/conpty/${versions[0]}/win10-${arch}/${file}`))
        expect(bytes.subarray(0, 2).toString()).toBe('MZ')
      }
    }
  })
})
