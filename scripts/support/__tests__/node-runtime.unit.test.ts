import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pathWithoutBunNode } from '../node-runtime'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pathWithoutBunNode', () => {
  it('drops a directory whose node is the Bun executable and keeps the others in order', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'node-runtime-'))
    roots.push(root)
    const bun = path.join(root, 'bun')
    const shim = path.join(root, 'bun-node')
    const node = path.join(root, 'node-bin')
    const empty = path.join(root, 'empty')
    await Promise.all([mkdir(shim), mkdir(node), mkdir(empty), writeFile(bun, '')])
    await Promise.all([
      symlink(bun, path.join(shim, 'node')),
      writeFile(path.join(node, 'node'), ''),
    ])

    expect(pathWithoutBunNode([shim, empty, node].join(':'), bun, ':')).toBe(`${empty}:${node}`)
  })
})
