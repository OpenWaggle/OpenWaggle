import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  automationOptions,
  devBuildDirectory,
  hutchDevInvocation,
  parseDevArguments,
} from '../electrobun/dev'

describe('bun run dev', () => {
  it('runs electrobun dev through the configured Hutch, in the dev build environment', () => {
    expect(hutchDevInvocation({ OPENWAGGLE_HUTCH: 'hutch electrobun' }, 'dev')).toEqual({
      executable: 'hutch',
      args: ['electrobun', 'dev', '--env=dev'],
    })
    expect(hutchDevInvocation({}, 'build')).toEqual({
      executable: process.execPath,
      args: ['x', 'electrobun', 'build', '--env=dev'],
    })
  })

  it('finds the dev app where Hutch builds it', () => {
    expect(devBuildDirectory('/repo', 'darwin', 'arm64')).toBe(
      path.join('/repo', 'out', 'electrobun', 'build', 'dev-macos-arm64'),
    )
    expect(devBuildDirectory('/repo', 'win32', 'x64')).toBe(
      path.join('/repo', 'out', 'electrobun', 'build', 'dev-win-x64'),
    )
    expect(devBuildDirectory('/repo', 'linux', 'x64')).toBe(
      path.join('/repo', 'out', 'electrobun', 'build', 'dev-linux-x64'),
    )
  })

  it('takes --debug and --skip-build', () => {
    expect(parseDevArguments([])).toEqual({ debug: false, skipBuild: false })
    expect(parseDevArguments(['--debug', '--skip-build'])).toEqual({
      debug: true,
      skipBuild: true,
    })
  })

  it('hands dev:debug the caller automation options and this checkout, nothing else', () => {
    expect(
      automationOptions(
        {
          HOME: '/Users/maintainer',
          OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: '1',
          OPENWAGGLE_AUTOMATION_PROJECT_PATH: '/elsewhere',
        },
        '/repo',
      ),
    ).toEqual({
      OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: '1',
      OPENWAGGLE_AUTOMATION_PROJECT_PATH: '/repo',
    })
  })
})
