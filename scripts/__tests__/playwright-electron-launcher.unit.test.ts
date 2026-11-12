import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildPlaywrightElectronEnvironment,
  playwrightElectronArguments,
} from '../playwright-electron-launcher'

const REAL_HOME = '/Users/maintainer'
const previousHome = process.env.HOME
const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir
})

describe('Playwright Electron launch isolation', () => {
  it('never hands the app the caller HOME or Pi agent directory', () => {
    process.env.HOME = REAL_HOME
    process.env.PI_CODING_AGENT_DIR = `${REAL_HOME}/.pi/agent`

    const environment = buildPlaywrightElectronEnvironment({
      userDataDir: '/tmp/shots',
      hidden: true,
    })

    expect(environment).toMatchObject({
      HOME: path.join('/tmp/shots', 'home'),
      USERPROFILE: path.join('/tmp/shots', 'home'),
      PI_CODING_AGENT_DIR: path.join('/tmp/shots', 'home', '.pi', 'agent'),
      OPENWAGGLE_USER_DATA_DIR: '/tmp/shots',
    })
    expect(Object.values(environment).filter((value) => value.startsWith(REAL_HOME))).toEqual([])
  })

  it('keeps a scratch home or Pi agent directory the caller chose', () => {
    expect(
      buildPlaywrightElectronEnvironment({
        userDataDir: '/tmp/shots/user-data',
        hidden: true,
        homeDir: '/tmp/shots/home',
        piAgentDir: '/tmp/shots/pi-agent',
      }),
    ).toMatchObject({ HOME: '/tmp/shots/home', PI_CODING_AGENT_DIR: '/tmp/shots/pi-agent' })
  })

  it('does not let a fixture environment put the real home back', () => {
    expect(
      buildPlaywrightElectronEnvironment({
        userDataDir: '/tmp/shots',
        hidden: true,
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
    expect(playwrightElectronArguments({ appPath: '/repo' }, platform)).toEqual([
      '/repo',
      ...switches,
    ])
    expect(
      playwrightElectronArguments({ executablePath: '/Applications/OpenWaggle' }, platform),
    ).toEqual(switches)
  })
})
