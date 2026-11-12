import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import config from '../../electron-builder'
import { removeUnusedChromiumFiles, unusedChromiumFiles } from '../electron-builder-after-pack'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function packedApp(files: readonly string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-'))
  roots.push(root)
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), '')
  }
  return root
}

describe('removeUnusedChromiumFiles', () => {
  it('names SwiftShader and its manifest beside Chromium on each platform', () => {
    expect(unusedChromiumFiles('/out/OpenWaggle.app', 'darwin')).toEqual([
      '/out/OpenWaggle.app/Contents/Frameworks/Electron Framework.framework/Libraries/libvk_swiftshader.dylib',
      '/out/OpenWaggle.app/Contents/Frameworks/Electron Framework.framework/Libraries/vk_swiftshader_icd.json',
    ])
    expect(
      unusedChromiumFiles('/out/win-unpacked', 'win32').map((file) => path.basename(file)),
    ).toEqual(['vk_swiftshader.dll', 'vk_swiftshader_icd.json'])
    expect(
      unusedChromiumFiles('/out/linux-unpacked', 'linux').map((file) => path.basename(file)),
    ).toEqual(['libvk_swiftshader.so', 'vk_swiftshader_icd.json'])
  })

  it('removes them from a pack and keeps the rest of Chromium, ANGLE and the Vulkan loader', async () => {
    const appOutDir = packedApp([
      'openwaggle',
      'libvk_swiftshader.so',
      'vk_swiftshader_icd.json',
      'libvulkan.so.1',
      'libGLESv2.so',
    ])
    await removeUnusedChromiumFiles({
      appOutDir,
      electronPlatformName: 'linux',
      packager: { appInfo: { productFilename: 'OpenWaggle' } },
    })
    expect(fs.readdirSync(appOutDir).sort()).toEqual([
      'libGLESv2.so',
      'libvulkan.so.1',
      'openwaggle',
    ])
  })

  it('runs after every pack, before signing', () => {
    expect(config.afterPack).toBe(removeUnusedChromiumFiles)
  })
})

describe('artifact compression', () => {
  it('compresses at the highest level but keeps the AppImage gzip, which reads fast through FUSE', () => {
    expect(config.compression).toBe('maximum')
    expect(config.appImage).toEqual({ compression: 'gzip' })
  })
})
