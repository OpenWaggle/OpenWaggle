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

function buildDirectory(files: readonly string[], links: Readonly<Record<string, string>> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-cef-prune-'))
  roots.push(root)
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), '')
  }
  for (const [link, target] of Object.entries(links)) {
    fs.symlinkSync(target, path.join(root, link))
  }
  return root
}

function listed(root: string) {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort()
}

const native = (file: string) => path.join(...file.split('/'))

describe('Linux CEF prune', () => {
  it('names SwiftShader and every locale pack but en-US beside a CEF that is not linked', () => {
    expect(
      unusedCefFiles({
        directory: '/app/bin',
        listing: {
          files: ['libcef.so', 'resources.pak', 'libvk_swiftshader.so', 'vk_swiftshader_icd.json'],
          links: new Map(),
          directories: ['locales'],
        },
        locales: ['en-US.pak', 'de.pak', 'fr.pak.info', 'README'],
      }),
    ).toEqual([
      '/app/bin/libvk_swiftshader.so',
      '/app/bin/vk_swiftshader_icd.json',
      '/app/bin/locales/de.pak',
      '/app/bin/locales/fr.pak.info',
    ])
  })

  it("names the linked distribution's copies of the executable directory's data and its locales", () => {
    expect(
      unusedCefFiles({
        directory: '/app/bin',
        listing: {
          files: ['resources.pak', 'icudtl.dat', 'vk_swiftshader_icd.json', 'bun'],
          links: new Map([
            ['libcef.so', 'cef/libcef.so'],
            ['libvk_swiftshader.so', 'cef/libvk_swiftshader.so'],
          ]),
          directories: ['cef', 'locales'],
        },
        locales: ['en-US.pak', 'ja.pak'],
        library: {
          directory: '/app/bin/cef',
          listing: {
            files: ['libcef.so', 'resources.pak', 'icudtl.dat', 'libvk_swiftshader.so'],
            links: new Map(),
            directories: ['locales'],
          },
          locales: ['en-US.pak', 'ja.pak'],
        },
      }),
    ).toEqual([
      '/app/bin/libvk_swiftshader.so',
      '/app/bin/vk_swiftshader_icd.json',
      '/app/bin/locales/ja.pak',
      '/app/bin/cef/libvk_swiftshader.so',
      '/app/bin/cef/resources.pak',
      '/app/bin/cef/icudtl.dat',
      '/app/bin/cef/locales/en-US.pak',
      '/app/bin/cef/locales/ja.pak',
    ])
  })

  it("prunes and strips Electrobun's Linux layout and keeps what CEF loads", async () => {
    const root = buildDirectory(
      [
        'OpenWaggle/bin/bun',
        'OpenWaggle/bin/resources.pak',
        'OpenWaggle/bin/icudtl.dat',
        'OpenWaggle/bin/vk_swiftshader_icd.json',
        'OpenWaggle/bin/locales/en-US.pak',
        'OpenWaggle/bin/locales/de.pak',
        'OpenWaggle/bin/cef/libcef.so',
        'OpenWaggle/bin/cef/libvulkan.so.1',
        'OpenWaggle/bin/cef/libvk_swiftshader.so',
        'OpenWaggle/bin/cef/resources.pak',
        'OpenWaggle/bin/cef/icudtl.dat',
        'OpenWaggle/bin/cef/locales/en-US.pak',
        'OpenWaggle/bin/cef/locales/de.pak',
        'OpenWaggle/Resources/app/node_modules/x/locales/de.pak',
      ],
      {
        'OpenWaggle/bin/libcef.so': 'cef/libcef.so',
        'OpenWaggle/bin/libvulkan.so.1': 'cef/libvulkan.so.1',
        'OpenWaggle/bin/libvk_swiftshader.so': 'cef/libvk_swiftshader.so',
      },
    )
    const stripped: string[] = []
    const strip = async (file: string) => {
      stripped.push(file)
    }
    const result = await pruneLinuxCef(root, strip)
    expect(result.stripped).toEqual([native('OpenWaggle/bin/cef/libcef.so')])
    expect(stripped).toEqual([path.join(root, native('OpenWaggle/bin/cef/libcef.so'))])
    expect(listed(root)).toEqual(
      [
        'OpenWaggle/Resources/app/node_modules/x/locales/de.pak',
        'OpenWaggle/bin/bun',
        'OpenWaggle/bin/cef/libcef.so',
        'OpenWaggle/bin/cef/libvulkan.so.1',
        'OpenWaggle/bin/icudtl.dat',
        'OpenWaggle/bin/libcef.so',
        'OpenWaggle/bin/libvulkan.so.1',
        'OpenWaggle/bin/locales/en-US.pak',
        'OpenWaggle/bin/resources.pak',
      ].map(native),
    )
  })
})
