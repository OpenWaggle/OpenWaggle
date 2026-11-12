import { readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  electronDevInvocation,
  electronViteEntryPath,
  isElectronDevTarget,
  withoutRunAsNode,
} from '../run-electron-dev'

const ROOT = path.join('/work', 'OpenWaggle')

function packageScripts(): [string, string][] {
  const manifest: unknown = JSON.parse(readFileSync('package.json', 'utf8'))
  if (typeof manifest !== 'object' || manifest === null || !('scripts' in manifest)) return []
  const { scripts } = manifest
  if (typeof scripts !== 'object' || scripts === null) return []
  return Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
}

describe('run-electron-dev', () => {
  it('starts electron-vite dev through this Node, without the run-as-Node switch', () => {
    const invocation = electronDevInvocation('vite', ['--', '--remote-debugging-port=9222'], {
      environment: { ELECTRON_RUN_AS_NODE: '1', PATH: '/bin' },
      nodeExecutable: '/usr/bin/node',
      platform: 'darwin',
      projectRoot: ROOT,
    })

    expect(invocation).toEqual({
      command: '/usr/bin/node',
      args: [electronViteEntryPath(ROOT), 'dev', '--', '--remote-debugging-port=9222'],
      environment: { PATH: '/bin', ELECTRON_ENABLE_LOGGING: '1' },
    })
  })

  it('starts Electron on the project for the development CLI, without turning on logging', () => {
    const invocation = electronDevInvocation('electron', ['hive', 'list'], {
      environment: { ELECTRON_RUN_AS_NODE: '1', PATH: '/bin' },
      electronExecutable: () => '/electron',
      platform: 'linux',
      projectRoot: ROOT,
    })

    expect(invocation).toEqual({
      command: '/electron',
      args: [ROOT, 'hive', 'list'],
      environment: { PATH: '/bin' },
    })
  })

  it('removes the switch under any capitalization on Windows only', () => {
    const environment = { Electron_Run_As_Node: '1', ELECTRON_RUN_AS_NODE: '1', Path: 'C:\\bin' }

    expect(withoutRunAsNode(environment, 'win32')).toEqual({ Path: 'C:\\bin' })
    expect(withoutRunAsNode(environment, 'linux')).toEqual({
      Electron_Run_As_Node: '1',
      Path: 'C:\\bin',
    })
  })

  it('accepts only its two targets', () => {
    expect(isElectronDevTarget('vite')).toBe(true)
    expect(isElectronDevTarget('electron')).toBe(true)
    expect(isElectronDevTarget('dev')).toBe(false)
    expect(isElectronDevTarget(undefined)).toBe(false)
  })

  it('points at the electron-vite entry script that is installed', async () => {
    await expect(access(electronViteEntryPath())).resolves.toBeUndefined()
  })

  // pnpm runs package scripts with cmd.exe on Windows, which has no `env` and no `NAME=value`
  // prefix, so a script written that way works on macOS and Linux and fails on Windows.
  it.each(packageScripts())(
    'keeps the %s script free of POSIX-only environment syntax',
    (_name, script) => {
      for (const command of script.split(/&&|\|\||;/u).map((part) => part.trim())) {
        expect(command).not.toMatch(/^env\b/u)
        expect(command).not.toMatch(/^[A-Za-z_][A-Za-z0-9_]*=/u)
      }
    },
  )
})
