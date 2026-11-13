import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { readEnvironmentVariables } from '../env'
import {
  launchWindowsHeadlessProcess,
  WINDOWS_CHILD_REQUIRED_VARIABLES,
} from '../windows-headless-process'

const RESULT_WAIT_MS = 20_000
const POLL_MS = 100

async function readWhenWritten(file: string) {
  const deadline = Date.now() + RESULT_WAIT_MS
  while (Date.now() < deadline) {
    try {
      const written: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      return written
    } catch {
      await delay(POLL_MS)
    }
  }
  throw new Error(`The launched process wrote no ${file}`)
}

// CreateProcessW through bun:ffi, on a real Windows machine (the Electrobun probe job runs it).
describe.runIf(process.platform === 'win32')('Windows headless process launch (kernel32)', () => {
  it('starts the command with its arguments and exactly its environment', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'headless-launch-'))
    const result = path.join(directory, 'result.json')
    const script = [
      "const fs = require('node:fs')",
      'fs.writeFileSync(process.argv.at(-3), JSON.stringify({',
      '  args: process.argv.slice(-2),',
      '  marker: process.env.OW_HEADLESS_MARKER ?? null,',
      // Set for every Windows process, so only a child that inherited this one's has it.
      '  leaked: process.env.ProgramFiles ?? null,',
      '  hasSystemRoot: typeof process.env.SystemRoot === "string",',
      '}))',
    ].join('\n')
    try {
      await launchWindowsHeadlessProcess({
        command: process.execPath,
        args: ['-e', script, result, 'say "yes" 🐝', 'C:\\trailing\\'],
        environment: { OW_HEADLESS_MARKER: 'child' },
        inherited: readEnvironmentVariables(WINDOWS_CHILD_REQUIRED_VARIABLES),
      })
      expect(await readWhenWritten(result)).toEqual({
        args: ['say "yes" 🐝', 'C:\\trailing\\'],
        marker: 'child',
        leaked: null,
        hasSystemRoot: true,
      })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reports the Win32 error when the executable does not exist', async () => {
    await expect(
      launchWindowsHeadlessProcess({
        command: path.join(os.tmpdir(), 'openwaggle-missing', 'missing.exe'),
        args: [],
        environment: {},
        inherited: {},
      }),
    ).rejects.toThrow(/create-process \(Win32 code \d+\)/u)
  })
})
