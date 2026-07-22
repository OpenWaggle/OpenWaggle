import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionBuildRunner } from '../../ports/extension-build-runner'
import { ExtensionBuildRunnerLive } from '../extension-build-runner'

let tmpRoot = ''

function runBuild(command: string) {
  return Effect.gen(function* () {
    const runner = yield* ExtensionBuildRunner
    return yield* runner.run({ packagePath: tmpRoot, command })
  }).pipe(Effect.provide(ExtensionBuildRunnerLive))
}

describe('ExtensionBuildRunnerLive', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extension-build-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('runs the approved build command from the extension package root', async () => {
    const command = [
      'node',
      '-e',
      "\"const fs = require('fs'); fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/index.js', 'built')\"",
    ].join(' ')

    const result = await Effect.runPromise(runBuild(command))

    await expect(fs.readFile(path.join(tmpRoot, 'dist', 'index.js'), 'utf8')).resolves.toBe('built')
    expect(result.exitCode).toBe(0)
  })

  it('returns command failures as build results instead of throwing', async () => {
    const result = await Effect.runPromise(runBuild('node -e "process.exit(7)"'))

    expect(result.exitCode).toBe(7)
  })
})
