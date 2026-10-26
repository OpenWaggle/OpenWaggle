import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTestTemporaryDirectory,
  temporaryDirectoryLeaks,
} from '../temporary-directory-guard'

const created: string[] = []

function runRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-run-'))
  created.push(root)
  return root
}

afterEach(() => {
  for (const root of created.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('the test temporary-directory guard', () => {
  it('reports every entry a test file left behind', () => {
    expect(temporaryDirectoryLeaks(['openwaggle-pi-agent-1', 'ow-test-user-2'])).toEqual([
      'openwaggle-pi-agent-1',
      'ow-test-user-2',
    ])
  })

  it('does not count the shared caches tools keep in the temporary directory', () => {
    expect(temporaryDirectoryLeaks(['jiti', 'node-compile-cache', 'tsx-501', 'left-behind'])).toEqual([
      'left-behind',
    ])
  })

  it('gives each test file a private temporary directory inside the run root', () => {
    const root = runRoot()
    const environment: NodeJS.ProcessEnv = {}
    const directory = createTestTemporaryDirectory({ runRoot: root, environment })

    expect(path.dirname(directory.root)).toBe(root)
    expect(environment.TMPDIR).toBe(directory.temporaryDirectory)
    expect(environment.TMP).toBe(directory.temporaryDirectory)
    expect(environment.TEMP).toBe(directory.temporaryDirectory)
    expect(fs.statSync(directory.temporaryDirectory).isDirectory()).toBe(true)
  })

  it('removes a clean file directory, restores the environment, and passes', () => {
    const root = runRoot()
    const environment: NodeJS.ProcessEnv = { TMPDIR: '/before' }
    const directory = createTestTemporaryDirectory({ runRoot: root, environment })
    fs.mkdirSync(path.join(directory.temporaryDirectory, 'jiti'))

    expect(() => directory.finish('clean.unit.test.ts')).not.toThrow()
    expect(fs.existsSync(directory.root)).toBe(false)
    expect(environment).toEqual({ TMPDIR: '/before' })
  })

  it('removes a leaked directory and fails the test file that left it', () => {
    const root = runRoot()
    const directory = createTestTemporaryDirectory({ runRoot: root, environment: {} })
    fs.mkdirSync(path.join(directory.temporaryDirectory, 'openwaggle-pi-skills-abc123'))
    fs.writeFileSync(path.join(directory.temporaryDirectory, 'openwaggle-pi-skills-abc123', 'settings.json'), '{}')
    fs.writeFileSync(path.join(directory.temporaryDirectory, 'stray.txt'), 'x')

    expect(() => directory.finish('leaky.unit.test.ts')).toThrow(
      'leaky.unit.test.ts left 2 entries in its temporary directory: openwaggle-pi-skills-abc123 (settings.json), stray.txt.',
    )
    expect(fs.existsSync(directory.root)).toBe(false)
  })
})
