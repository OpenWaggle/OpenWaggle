import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getContentHashRelativePaths, getManifestContentHashInput } from '../content-hash-input'
import { calculateContentHash } from '../package-files'

let tmpRoot = ''

const MANIFEST = '{"manifestVersion":1}'
const HASH_INPUT = {
  builtArtifacts: ['dist/index.js'],
  runtimeFiles: [],
  optionalFiles: ['assets/icon.svg'],
}

async function writeText(relativePath: string, value: string) {
  const filePath = path.join(tmpRoot, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf-8')
}

async function contentHash() {
  const result = await calculateContentHash(tmpRoot, MANIFEST, HASH_INPUT)
  expect(result.diagnostics).toEqual([])
  return result.contentHash
}

describe('optional files in the extension content hash', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-optional-hash-'))
    await writeText('dist/index.js', 'export {}\n')
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('collects side panel SVG icons as optional files, not runtime files', () => {
    const input = getManifestContentHashInput({
      builtArtifacts: ['dist/index.js'],
      contributions: {
        sidePanels: [
          { entry: 'dist/index.js', icon: { svg: 'assets/icon.svg' } },
          { entry: 'dist/index.js', icon: 'ticket' },
          { entry: 'dist/index.js' },
        ],
      },
    })

    expect(input.optionalFiles).toEqual(['assets/icon.svg'])
    expect(getContentHashRelativePaths(input)).not.toContain('assets/icon.svg')
  })

  it('omits optional files when no side panel declares an SVG icon', () => {
    expect(getManifestContentHashInput({ builtArtifacts: ['dist/index.js'] })).toEqual({
      builtArtifacts: ['dist/index.js'],
      runtimeFiles: [],
    })
  })

  it('keeps a valid hash when an optional file is missing', async () => {
    expect(await contentHash()).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('changes the hash when the optional file is added or edited', async () => {
    const missing = await contentHash()
    await writeText('assets/icon.svg', '<svg/>')
    const added = await contentHash()
    await writeText('assets/icon.svg', '<svg viewBox="0 0 1 1"/>')
    const edited = await contentHash()

    expect(new Set([missing, added, edited]).size).toBe(3)
  })
})
