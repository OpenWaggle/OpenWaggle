import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findPiCodingAgentPackageDirectory } from '../pi-package-directory'

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-package-dir-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('Pi package directory', () => {
  it("finds Pi's installed package from a bundle file, not the app package that contains it", async () => {
    const piPackage = path.join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
    await fs.mkdir(piPackage, { recursive: true })
    await fs.writeFile(
      path.join(piPackage, 'package.json'),
      '{"name":"@earendil-works/pi-coding-agent"}',
    )
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"openwaggle"}')
    const bundleFile = path.join(root, 'out', 'main', 'index.js')

    expect(findPiCodingAgentPackageDirectory(bundleFile)).toBe(piPackage)
  })

  it('finds nothing when Pi is not installed beside the bundle', () => {
    expect(
      findPiCodingAgentPackageDirectory(path.join(root, 'out', 'main', 'index.js')),
    ).toBeUndefined()
  })
})
