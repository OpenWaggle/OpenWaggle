import { describe, expect, it } from 'vitest'
import { playwrightWorkerCount } from '../../playwright.config'

describe('Electron E2E worker isolation', () => {
  it('isolates macOS CI from concurrent Electron apps without changing test budgets', () => {
    expect(playwrightWorkerCount(true, 'darwin', '2')).toBe(1)
  })

  it('preserves parallel workers on Linux and Windows CI', () => {
    expect(playwrightWorkerCount(true, 'linux', '2')).toBe(2)
    expect(playwrightWorkerCount(true, 'win32', '2')).toBe(2)
  })

  it('preserves explicit local macOS parallelism', () => {
    expect(playwrightWorkerCount(false, 'darwin', '3')).toBe(3)
  })

  it.each([undefined, '', 'invalid', '0', '-1'])('defaults invalid counts to one worker', (value) => {
    expect(playwrightWorkerCount(false, 'linux', value)).toBe(1)
  })
})
