import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareLiveQaCliExecutable } from '../live-session-cli-executable'
import {
  launchGui,
  runProcess,
  selectPackagedExecutable,
  type StoppableChild,
  stopChild,
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

  it('terminates the complete Windows process tree and waits for proven exit', async () => {
    class FakeChild implements StoppableChild {
      readonly pid = 42
      readonly exitCode = null
      readonly signalCode = null
      readonly kill = vi.fn(() => true)
      once() {
        return this
      }
      off() {
        return this
      }
    }
    const child = new FakeChild()
    const waitForExit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const terminateWindowsTree = vi.fn(async () => undefined)

    await stopChild(child, { platform: 'win32', terminateWindowsTree, waitForExit })

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(terminateWindowsTree).toHaveBeenCalledWith(42)
    expect(waitForExit).toHaveBeenCalledTimes(2)
  })

  it('fails closed when forced termination cannot prove process exit', async () => {
    class FakeChild implements StoppableChild {
      readonly pid = 43
      readonly exitCode = null
      readonly signalCode = null
      readonly kill = vi.fn(() => true)
      once() {
        return this
      }
      off() {
        return this
      }
    }

    await expect(
      stopChild(new FakeChild(), {
        platform: 'linux',
        waitForExit: async () => false,
      }),
    ).rejects.toThrow('Could not prove GUI process 43 exited')
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
