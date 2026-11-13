import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { marksInLog, startupMarksSince } from '../startup-marks'

const DATE = '2026-11-13'
const SPAWNED_AT = Date.parse(`${DATE}T09:00:00.000Z`)

function markLine(time: string, label: string) {
  return `${time}Z [startup] Startup timing at 812.4 ms uptime {"label":"${label}","elapsedMs":700.1}`
}

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('startup marks', () => {
  it('places the first mark of each label after the spawn on the wall clock', () => {
    const text = [
      markLine('08:59:59.000', 'window-ready-to-show'),
      '09:00:00.100Z [updater] Checking for update',
      markLine('09:00:01.250', 'window-ready-to-show'),
      markLine('09:00:02.000', 'window-ready-to-show'),
    ].join('\n')
    expect([...marksInLog(text, DATE, SPAWNED_AT)]).toEqual([
      ['window-ready-to-show', SPAWNED_AT + 1250],
    ])
  })

  it("reads the app's and the Session Host's logs, the Host's marks under host:", () => {
    const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-marks-'))
    directories.push(logs)
    fs.writeFileSync(
      path.join(logs, `openwaggle-${DATE}.log`),
      markLine('09:00:01.500', 'window-ready-to-show'),
    )
    fs.writeFileSync(
      path.join(logs, `openwaggle-host-${DATE}.log`),
      markLine('09:00:02.000', 'ready'),
    )
    fs.writeFileSync(path.join(logs, 'other.log'), markLine('09:00:00.500', 'ignored'))
    expect(startupMarksSince(logs, SPAWNED_AT)).toEqual({
      'window-ready-to-show': 1500,
      'host:ready': 2000,
    })
    expect(startupMarksSince(path.join(logs, 'missing'), SPAWNED_AT)).toEqual({})
  })
})
