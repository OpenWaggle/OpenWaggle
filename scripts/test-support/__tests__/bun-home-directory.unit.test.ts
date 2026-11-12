import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { followHomeEnvironmentOnBun, homeFromEnvironment } from '../bun-home-directory'

describe('homeFromEnvironment', () => {
  it('reads HOME on POSIX and USERPROFILE on Windows, as Node does', () => {
    const environment = { HOME: '/home/test', USERPROFILE: 'C:\\Users\\test' }
    expect(homeFromEnvironment(environment, 'linux')).toBe('/home/test')
    expect(homeFromEnvironment(environment, 'win32')).toBe('C:\\Users\\test')
    expect(homeFromEnvironment({ HOME: '' }, 'darwin')).toBeUndefined()
  })
})

describe('followHomeEnvironmentOnBun', () => {
  it('leaves homedir alone outside Bun', () => {
    const builtin = { homedir: () => '/startup' }
    followHomeEnvironmentOnBun({ node: '24.0.0' }, builtin)
    expect(builtin.homedir()).toBe('/startup')
  })

  it('makes homedir follow HOME at call time on Bun', () => {
    const builtin = { homedir: () => '/startup' }
    followHomeEnvironmentOnBun({ bun: '1.4.4' }, builtin)
    expect(builtin.homedir()).toBe(homeFromEnvironment(process.env, process.platform))
  })

  it('is what the tiers resolve node:os to, so the per-file HOME reaches code under test', () => {
    expect(os.homedir()).toBe(process.env.HOME)
  })
})
