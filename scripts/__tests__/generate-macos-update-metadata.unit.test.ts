import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { generateMacosUpdateMetadata } from '../generate-macos-update-metadata'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('macOS update metadata', () => {
  it('combines exact matching-architecture ZIP and DMG artifacts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mac-update-'))
    roots.push(root)
    const version = '1.2.3-alpha.4'
    const names = [
      `openwaggle-${version}-arm64.zip`,
      `openwaggle-${version}-arm64.dmg`,
      `openwaggle-${version}-x64.zip`,
      `openwaggle-${version}-x64.dmg`,
    ]
    await Promise.all(names.map((name) => fs.writeFile(path.join(root, name), name)))

    await generateMacosUpdateMetadata({
      directory: root,
      version,
      releaseDate: '2026-01-02T03:04:05.000Z',
    })

    const metadata: unknown = parse(await fs.readFile(path.join(root, 'latest-mac.yml'), 'utf8'))
    expect(metadata).toMatchObject({
      version,
      files: names.map((url) => ({ url, size: url.length })),
      path: `openwaggle-${version}-x64.zip`,
      releaseDate: '2026-01-02T03:04:05.000Z',
    })
  })

  it('fails closed when either architecture output is absent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mac-update-'))
    roots.push(root)

    await expect(
      generateMacosUpdateMetadata({ directory: root, version: '1.2.3' }),
    ).rejects.toThrow()
    await expect(fs.access(path.join(root, 'latest-mac.yml'))).rejects.toThrow()
  })

  it('runs directly under the pinned release Node runtime', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mac-update-'))
    roots.push(root)
    const version = '1.2.3'
    await Promise.all(
      ['arm64.zip', 'arm64.dmg', 'x64.zip', 'x64.dmg'].map((suffix) =>
        fs.writeFile(path.join(root, `openwaggle-${version}-${suffix}`), suffix),
      ),
    )

    const result = spawnSync(
      process.execPath,
      ['--no-warnings', path.resolve('scripts/generate-macos-update-metadata.ts'), root, version],
      { encoding: 'utf8' },
    )

    expect(result).toMatchObject({ status: 0, stderr: '' })
    await expect(fs.access(path.join(root, 'latest-mac.yml'))).resolves.toBeUndefined()
  })
})
