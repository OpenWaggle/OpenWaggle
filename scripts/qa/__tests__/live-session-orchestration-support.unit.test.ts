import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareLiveQaCliExecutable } from '../live-session-cli-executable'
import {
  launchGui,
  runProcess,
  selectPackagedExecutable,
  waitForHost,
} from '../live-session-orchestration-support'
import {
  transcriptInvokedSessionsSpawn,
  transcriptInvokedSkill,
} from '../live-session-transcript-evidence'

describe('live Session orchestration support', () => {
  let workingDirectory: string | undefined

  afterEach(async () => {
    if (workingDirectory) await fs.rm(workingDirectory, { recursive: true, force: true })
  })

  it('uses the production Linux shim contract for packaged CLI output', async () => {
    workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-live-qa-support-'))
    const executable = path.join(workingDirectory, 'fake-appimage')
    await fs.writeFile(
      executable,
      "#!/bin/sh\nprintf 'Electron diagnostic\\n{}\\n'\nprintf '{\"ok\":true}\\n' >&3\n",
      { mode: 0o700 },
    )
    const command = await prepareLiveQaCliExecutable({
      executable,
      workingDirectory,
      platform: 'linux',
    })

    await expect(runProcess(command, [], {})).resolves.toMatchObject({
      stdout: '{"ok":true}\n',
      stderr: '',
    })
  })

  it('prefers the Linux AppImage when unpacked build output also exists', () => {
    expect(
      selectPackagedExecutable(
        ['/project/dist/linux-unpacked/openwaggle', '/project/dist/openwaggle-x64.AppImage'],
        'linux',
      ),
    ).toBe('/project/dist/openwaggle-x64.AppImage')
  })

  it('rejects a GUI spawn error so the profile lifecycle can retain evidence', async () => {
    const missingExecutable = path.join(
      os.tmpdir(),
      `openwaggle-missing-gui-${process.pid}-${Date.now()}`,
    )

    await expect(launchGui(missingExecutable, {})).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bounds a hanging CLI probe and terminates its descendant process', async () => {
    workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-live-qa-timeout-'))
    const descendantMarker = path.join(workingDirectory, 'descendant-survived')
    const descendantScript = [
      `const fs = require('node:fs')`,
      `setTimeout(() => fs.writeFileSync(${JSON.stringify(descendantMarker)}, 'alive'), 1200)`,
      `setInterval(() => undefined, 1000)`,
    ].join(';')
    const parentScript = [
      `const { spawn } = require('node:child_process')`,
      `spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' })`,
      `setInterval(() => undefined, 1000)`,
    ].join(';')
    const startedAt = Date.now()

    await expect(
      runProcess(process.execPath, ['-e', parentScript], {}, { timeoutMs: 500 }),
    ).rejects.toThrow('timed out after 500ms')

    expect(Date.now() - startedAt).toBeLessThan(2_500)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await expect(fs.access(descendantMarker)).rejects.toThrow()
  })

  it('bounds each Host-readiness probe by the remaining startup deadline', async () => {
    let now = 1_000
    const runCli = vi.fn(async () => {
      now += 400
      throw new Error('Host unavailable')
    })

    await expect(
      waitForHost('/packaged/OpenWaggle', {}, {
        timeoutMs: 1_000,
        now: () => now,
        runCli,
        wait: async (milliseconds) => {
          now += milliseconds
        },
      }),
    ).rejects.toThrow('Session Host did not become ready')

    expect(runCli).toHaveBeenNthCalledWith(
      1,
      '/packaged/OpenWaggle',
      {},
      ['sessions', 'list', '--all', '--limit', '1'],
      { timeoutMs: 1_000 },
    )
    expect(runCli).toHaveBeenNthCalledWith(
      2,
      '/packaged/OpenWaggle',
      {},
      ['sessions', 'list', '--all', '--limit', '1'],
      { timeoutMs: 350 },
    )
  })

  it('does not treat a user prompt mention as a skill invocation', () => {
    const transcript = JSON.stringify({
      schemaVersion: 1,
      type: 'record',
      record: {
        record: 'item',
        item: {
          kind: 'message',
          role: 'user',
          content: [{ type: 'text', text: 'Do not use herdr-orchestration.' }],
        },
      },
    })

    expect(transcriptInvokedSkill(transcript, 'herdr-orchestration')).toBe(false)
  })

  it('detects a nested tool call that reads the skill', () => {
    const transcript = JSON.stringify({
      schemaVersion: 1,
      type: 'record',
      record: {
        record: 'item',
        item: {
          kind: 'message',
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              name: 'read',
              arguments: { path: '/skills/herdr-orchestration/SKILL.md' },
            },
          ],
        },
      },
    })

    expect(transcriptInvokedSkill(transcript, 'herdr-orchestration')).toBe(true)
  })

  it('detects only a structured native sessions spawn tool call', () => {
    const promptOnly = JSON.stringify({
      record: {
        record: 'item',
        item: { kind: 'message', role: 'user', content: 'Use sessions to spawn a Worker.' },
      },
    })
    const nativeToolCall = JSON.stringify({
      record: {
        record: 'item',
        item: {
          kind: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCall: { name: 'sessions', args: { action: 'spawn' } },
            },
          ],
        },
      },
    })
    const legacyToolCall = JSON.stringify({
      record: {
        record: 'item',
        item: {
          kind: 'message',
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              name: 'sessions',
              arguments: { operation: 'spawn' },
            },
          ],
        },
      },
    })

    expect(transcriptInvokedSessionsSpawn(promptOnly)).toBe(false)
    expect(transcriptInvokedSessionsSpawn(nativeToolCall)).toBe(true)
    expect(transcriptInvokedSessionsSpawn(legacyToolCall)).toBe(true)
  })
})
