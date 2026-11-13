import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildElectrobunAppEnvironment,
  credentialStoreArguments,
  resolveElectrobunLauncher,
} from '../electrobun-app-launch'

const REAL_HOME = '/Users/maintainer'
const CDP_PORT = 9300
const previousHome = process.env.HOME
const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir
})

describe('Electrobun automation launch isolation', () => {
  it('never hands the app the caller HOME or Pi agent directory', () => {
    process.env.HOME = REAL_HOME
    process.env.PI_CODING_AGENT_DIR = `${REAL_HOME}/.pi/agent`

    const environment = buildElectrobunAppEnvironment({
      userDataDir: '/tmp/shots',
      cdpPort: CDP_PORT,
    })

    expect(environment).toMatchObject({
      HOME: path.join('/tmp/shots', 'home'),
      USERPROFILE: path.join('/tmp/shots', 'home'),
      PI_CODING_AGENT_DIR: path.join('/tmp/shots', 'home', '.pi', 'agent'),
      OPENWAGGLE_USER_DATA_DIR: '/tmp/shots',
      OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    })
    expect(Object.values(environment).filter((value) => value.startsWith(REAL_HOME))).toEqual([])
  })

  it('always runs hidden in automation mode with the CEF DevTools endpoint on its port', () => {
    expect(
      buildElectrobunAppEnvironment({
        userDataDir: '/tmp/shots',
        cdpPort: CDP_PORT,
        environment: { OPENWAGGLE_AUTOMATION: '0', ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: '1' },
        platform: 'linux',
      }),
    ).toMatchObject({
      OPENWAGGLE_AUTOMATION: '1',
      OPENWAGGLE_QA_MAIN_WINDOW_RENDERER: 'cef',
      ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: String(CDP_PORT),
    })
  })

  it('keeps the Windows window in its own WebView2 environment, on a port apart from the previews', () => {
    const environment = buildElectrobunAppEnvironment({
      userDataDir: '/tmp/shots',
      cdpPort: CDP_PORT,
      previewCdpPort: CDP_PORT + 1,
      platform: 'win32',
    })

    expect(environment).toMatchObject({
      OPENWAGGLE_AUTOMATION: '1',
      ELECTROBUN_WEBVIEW2_MAIN_REMOTE_DEBUGGING_PORT: String(CDP_PORT),
      ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: String(CDP_PORT + 1),
    })
    expect(environment).not.toHaveProperty('OPENWAGGLE_QA_MAIN_WINDOW_RENDERER')
  })

  it("keeps the window in the user's webview and the profile's instance lock without DevTools", () => {
    const environment = buildElectrobunAppEnvironment({
      userDataDir: '/tmp/shots',
      cdpPort: CDP_PORT,
      windowDevTools: false,
      platform: 'darwin',
    })

    expect(environment).toMatchObject({ OPENWAGGLE_AUTOMATION: '1' })
    for (const variable of [
      'OPENWAGGLE_QA_MAIN_WINDOW_RENDERER',
      'OPENWAGGLE_DISABLE_SINGLE_INSTANCE',
      'ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT',
    ]) {
      expect(environment).not.toHaveProperty(variable)
    }
  })

  it('keeps a scratch home or Pi agent directory the caller chose', () => {
    expect(
      buildElectrobunAppEnvironment({
        userDataDir: '/tmp/shots/user-data',
        homeDir: '/tmp/shots/home',
        piAgentDir: '/tmp/shots/pi-agent',
        cdpPort: CDP_PORT,
      }),
    ).toMatchObject({ HOME: '/tmp/shots/home', PI_CODING_AGENT_DIR: '/tmp/shots/pi-agent' })
  })

  it('does not let a fixture environment put the real home back', () => {
    expect(
      buildElectrobunAppEnvironment({
        userDataDir: '/tmp/shots',
        cdpPort: CDP_PORT,
        environment: { HOME: REAL_HOME, PI_CODING_AGENT_DIR: `${REAL_HOME}/.pi/agent` },
      }),
    ).toMatchObject({
      HOME: path.join('/tmp/shots', 'home'),
      PI_CODING_AGENT_DIR: path.join('/tmp/shots', 'home', '.pi', 'agent'),
    })
  })

  it.each([
    ['darwin', ['--use-mock-keychain']],
    ['win32', ['--use-mock-keychain']],
    ['linux', ['--use-mock-keychain', '--password-store=basic']],
  ] as const)('keeps the app off the real credential store on %s', (platform, switches) => {
    expect(credentialStoreArguments(platform)).toEqual(switches)
  })

  it('finds the launcher of a macOS bundle and of an unpacked Linux app', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'electrobun-launch-'))
    try {
      const bundle = path.join(root, 'OpenWaggle.app')
      await fs.mkdir(path.join(bundle, 'Contents', 'MacOS'), { recursive: true })
      await fs.writeFile(path.join(bundle, 'Contents', 'MacOS', 'launcher'), '')
      const linux = path.join(root, 'openwaggle')
      await fs.mkdir(path.join(linux, 'bin'), { recursive: true })
      await fs.writeFile(path.join(linux, 'bin', 'launcher'), '')

      await expect(resolveElectrobunLauncher(bundle, 'darwin')).resolves.toBe(
        path.join(bundle, 'Contents', 'MacOS', 'launcher'),
      )
      await expect(resolveElectrobunLauncher(linux, 'linux')).resolves.toBe(
        path.join(linux, 'bin', 'launcher'),
      )
      await expect(resolveElectrobunLauncher(root, 'darwin')).rejects.toThrow(
        'has no Electrobun launcher',
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
