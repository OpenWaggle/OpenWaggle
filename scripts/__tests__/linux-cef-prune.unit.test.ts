import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneLinuxCef, unusedCefFiles } from '../electrobun/linux-cef-prune'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function buildDirectory(files: readonly string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-cef-prune-'))
  roots.push(root)
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), '')
  }
  return root
}

function listed(root: string) {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort()
}

describe('Linux CEF prune', () => {
  it('names SwiftShader and every locale pack but en-US beside libcef.so', () => {
    expect(
      unusedCefFiles({
        directory: '/app/bin',
        files: ['libcef.so', 'libvk_swiftshader.so', 'vk_swiftshader_icd.json', 'libvulkan.so.1'],
        locales: ['en-US.pak', 'de.pak', 'fr.pak.info', 'README'],
      }),
    ).toEqual([
      '/app/bin/libvk_swiftshader.so',
      '/app/bin/vk_swiftshader_icd.json',
      '/app/bin/locales/de.pak',
      '/app/bin/locales/fr.pak.info',
    ])
  })

  it('prunes the app under the build directory and keeps the rest of CEF', async () => {
    const root = buildDirectory([
      'OpenWaggle/bin/libcef.so',
      'OpenWaggle/bin/libvk_swiftshader.so',
      'OpenWaggle/bin/vk_swiftshader_icd.json',
      'OpenWaggle/bin/libvulkan.so.1',
      'OpenWaggle/bin/libGLESv2.so',
      'OpenWaggle/bin/locales/en-US.pak',
      'OpenWaggle/bin/locales/de.pak',
      'OpenWaggle/Resources/app/node_modules/x/locales/de.pak',
    ])
    expect(await pruneLinuxCef(root)).toEqual([
      path.join('OpenWaggle', 'bin', 'libvk_swiftshader.so'),
      path.join('OpenWaggle', 'bin', 'vk_swiftshader_icd.json'),
      path.join('OpenWaggle', 'bin', 'locales', 'de.pak'),
    ])
    expect(listed(root)).toEqual(
      [
        'OpenWaggle/Resources/app/node_modules/x/locales/de.pak',
        'OpenWaggle/bin/libGLESv2.so',
        'OpenWaggle/bin/libcef.so',
        'OpenWaggle/bin/libvulkan.so.1',
        'OpenWaggle/bin/locales/en-US.pak',
      ].map((file) => path.join(...file.split('/'))),
    )
  })
})
