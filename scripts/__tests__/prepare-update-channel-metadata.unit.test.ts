import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareUpdateChannelMetadata } from '../prepare-update-channel-metadata'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function fixture(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-update-channel-'))
  roots.push(root)
  await fs.writeFile(path.join(root, name), 'version: 1.2.3\n')
  return root
}

describe('update channel metadata', () => {
  it('makes a stable release available to Stable, Beta, and Alpha users', async () => {
    const root = await fixture('latest-mac.yml')
    await expect(
      prepareUpdateChannelMetadata({ directory: root, buildChannel: 'stable', platform: 'mac' }),
    ).resolves.toEqual(['latest-mac.yml', 'beta-mac.yml', 'alpha-mac.yml'])
    await expect(fs.readdir(root)).resolves.toEqual([
      'alpha-mac.yml',
      'beta-mac.yml',
      'latest-mac.yml',
    ])
  })

  it('makes Beta releases available to Beta and Alpha users only', async () => {
    const root = await fixture('beta.yml')
    await expect(
      prepareUpdateChannelMetadata({ directory: root, buildChannel: 'beta', platform: 'windows' }),
    ).resolves.toEqual(['beta.yml', 'alpha.yml'])
    await expect(fs.readdir(root)).resolves.toEqual(['alpha.yml', 'beta.yml'])
  })

  it('keeps RC metadata isolated for exact-version installs', async () => {
    const root = await fixture('rc.yml')
    await expect(
      prepareUpdateChannelMetadata({ directory: root, buildChannel: 'rc', platform: 'windows' }),
    ).resolves.toEqual(['rc.yml'])
    await expect(fs.readdir(root)).resolves.toEqual(['rc.yml'])
  })

  it('keeps Alpha releases off the Stable and Beta feeds', async () => {
    const root = await fixture('alpha-linux.yml')
    await expect(
      prepareUpdateChannelMetadata({ directory: root, buildChannel: 'alpha', platform: 'linux' }),
    ).resolves.toEqual(['alpha-linux.yml'])
    await expect(fs.readdir(root)).resolves.toEqual(['alpha-linux.yml'])
  })
})
