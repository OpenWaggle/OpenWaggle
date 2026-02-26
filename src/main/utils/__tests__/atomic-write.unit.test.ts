import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWriteJSON } from '../atomic-write'

describe('atomicWriteJSON', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'atomic-write-'))
  })

  afterEach(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes JSON and reads it back', async () => {
    const filePath = path.join(tmpDir, 'data.json')
    const data = { hello: 'world', count: 42 }

    await atomicWriteJSON(filePath, data)

    const raw = await fsPromises.readFile(filePath, 'utf-8')
    expect(JSON.parse(raw)).toEqual(data)
  })

  it('uses specified indent', async () => {
    const filePath = path.join(tmpDir, 'indented.json')
    await atomicWriteJSON(filePath, { a: 1 }, 4)

    const raw = await fsPromises.readFile(filePath, 'utf-8')
    expect(raw).toBe(JSON.stringify({ a: 1 }, null, 4))
  })

  it('defaults to indent of 2', async () => {
    const filePath = path.join(tmpDir, 'default-indent.json')
    await atomicWriteJSON(filePath, { b: 2 })

    const raw = await fsPromises.readFile(filePath, 'utf-8')
    expect(raw).toBe(JSON.stringify({ b: 2 }, null, 2))
  })

  it('overwrites existing file atomically', async () => {
    const filePath = path.join(tmpDir, 'overwrite.json')
    await atomicWriteJSON(filePath, { version: 1 })
    await atomicWriteJSON(filePath, { version: 2 })

    const raw = await fsPromises.readFile(filePath, 'utf-8')
    expect(JSON.parse(raw)).toEqual({ version: 2 })
  })

  it('supports concurrent writes to the same file', async () => {
    const filePath = path.join(tmpDir, 'concurrent.json')
    const payloads = Array.from({ length: 25 }, (_unused, index) => ({
      version: index,
    }))

    const writes = await Promise.allSettled(
      payloads.map((payload) => atomicWriteJSON(filePath, payload)),
    )
    const rejected = writes.filter((result) => result.status === 'rejected')
    expect(rejected).toHaveLength(0)

    const raw = await fsPromises.readFile(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    expect(payloads).toContainEqual(parsed)
  })

  it('does not leave .tmp file on success', async () => {
    const filePath = path.join(tmpDir, 'clean.json')
    await atomicWriteJSON(filePath, { clean: true })

    const entries = await fsPromises.readdir(tmpDir)
    expect(entries).toEqual(['clean.json'])
  })

  it('propagates errors for invalid paths', async () => {
    const filePath = path.join(tmpDir, 'nonexistent', 'nested', 'data.json')
    await expect(atomicWriteJSON(filePath, { fail: true })).rejects.toThrow()
  })
})
