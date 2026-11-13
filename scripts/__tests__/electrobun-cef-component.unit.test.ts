import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleCefComponent } from '../electrobun/cef-component'
import {
  cefComponentArchiveName,
  cefComponentEntries,
  CEF_FRAMEWORK,
  devkitCefVersion,
  sha256File,
} from '../electrobun/cef-component-layout'
import { pinCefComponent } from '../electrobun/cef-component-manifest'

const roots: string[] = []
const CEF_VERSION_SOURCE = [
  'export const CEF_VERSION = `156.0.7+g47dbc1d`;',
  'export const CHROMIUM_VERSION = `156.0.8078.17`;',
].join('\n')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function scratch() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cef-component-'))
  roots.push(root)
  return root
}

async function devkit() {
  const root = await scratch()
  await fs.mkdir(path.join(root, 'api', 'shared'), { recursive: true })
  await fs.writeFile(path.join(root, 'api', 'shared', 'cef-version.ts'), CEF_VERSION_SOURCE)
  await fs.mkdir(path.join(root, 'cef', CEF_FRAMEWORK), { recursive: true })
  await fs.writeFile(path.join(root, 'cef', CEF_FRAMEWORK, 'Chromium Embedded Framework'), 'cef')
  await fs.writeFile(path.join(root, 'process_helper'), 'helper')
  return root
}

describe('the CEF component', () => {
  it('names the CEF version as the native layer does, and its archive without a plus', async () => {
    const version = await devkitCefVersion(await devkit())
    expect(version).toBe('156.0.7+g47dbc1d+chromium-156.0.8078.17')
    expect(cefComponentArchiveName(version, 'arm64')).toBe(
      'cef-component-156.0.7-g47dbc1d-darwin-arm64.tar.xz',
    )
  })

  it('lays the framework and every helper variant side by side', async () => {
    const directory = path.join(await scratch(), 'component')
    await assembleCefComponent(await devkit(), directory)
    expect((await fs.readdir(directory)).sort()).toEqual([...cefComponentEntries()].sort())
    const gpu = path.join(
      directory,
      'bun Helper (GPU).app',
      'Contents',
      'MacOS',
      'bun Helper (GPU)',
    )
    expect(await fs.readFile(gpu, 'utf8')).toBe('helper')
    // Rejects unless the helper is executable.
    await fs.access(gpu, fs.constants.X_OK)
  })

  it('pins one architecture in the manifest and keeps the other', async () => {
    const root = await scratch()
    const manifest = path.join(root, 'manifest.json')
    const other = { url: 'https://example.test/x64.tar.xz', sha256: 'b'.repeat(64), size: 2 }
    const cefVersion = '156.0.7+g47dbc1d+chromium-156.0.8078.17'
    await fs.writeFile(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        cefVersion,
        assets: {
          'darwin-arm64': { ...other, url: 'https://example.test/old' },
          'darwin-x64': other,
        },
      }),
    )
    const archive = path.join(root, 'component.tar.xz')
    await fs.writeFile(archive, 'archive bytes')
    const url = 'https://example.test/arm64.tar.xz'
    await pinCefComponent({ manifest, arch: 'arm64', url, archive })
    expect(JSON.parse(await fs.readFile(manifest, 'utf8'))).toEqual({
      schemaVersion: 1,
      cefVersion,
      assets: {
        'darwin-arm64': { url, sha256: await sha256File(archive), size: 13 },
        'darwin-x64': other,
      },
    })
  })
})
