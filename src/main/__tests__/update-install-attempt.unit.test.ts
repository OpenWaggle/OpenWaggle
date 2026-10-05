import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  recordUpdateInstallAttempt,
  shipItRefusedWhileRunning,
  takeUpdateInstallAttempt,
  updateInstallOutcome,
} from '../update-install-attempt'

// Copied from a real ~/Library/Caches/com.openwaggle.app.ShipIt/ShipIt_stderr.log on 1.0.0-beta.8.
const SHIPIT_REFUSED_LOG = `2026-10-05 21:31:24.164 ShipIt[11620:112722119] Detected this as an install request
ERROR: Unrecognized attribute string flag '?' in attribute string "T@"NSString",?,R,C" for property debugDescription
2026-10-05 21:31:41.362 ShipIt[11620:112722130] Beginning installation
2026-10-05 21:31:44.777 ShipIt[11620:112723444] Aborting update attempt because there are 2 running instances of the target app
2026-10-05 21:31:44.778 ShipIt[11620:112724014] Installation cancelled: Error Domain=SQRLInstallerErrorDomain Code=-9 "App Still Running Error"
2026-10-05 21:31:44.779 ShipIt[11620:112724014] ShipIt quitting
`

function localTime(text: string) {
  const [date = '', time = ''] = text.split(' ')
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute, second] = time.split(':').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day, hour, minute, second).getTime()
}

describe('update install attempts', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-update-attempt-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reports each recorded attempt once', async () => {
    const attempt = { fromVersion: '1.0.0-beta.8', toVersion: '1.0.0-beta.9', attemptedAt: 42 }
    await recordUpdateInstallAttempt(directory, attempt)

    await expect(takeUpdateInstallAttempt(directory)).resolves.toEqual(attempt)
    await expect(takeUpdateInstallAttempt(directory)).resolves.toBeNull()
  })

  it('ignores and removes an attempt file it cannot read', async () => {
    const file = path.join(directory, 'update-install-attempt.json')
    await writeFile(file, '{"fromVersion": 1}')

    await expect(takeUpdateInstallAttempt(directory)).resolves.toBeNull()
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('counts the attempt as installed once a different version starts', () => {
    expect(
      updateInstallOutcome({
        attempt: { fromVersion: '1.0.0-beta.8', toVersion: '1.0.0-beta.9', attemptedAt: 0 },
        currentVersion: '1.0.0-beta.9',
        shipItLog: SHIPIT_REFUSED_LOG,
      }),
    ).toEqual({ type: 'installed', version: '1.0.0-beta.9' })
  })

  it('names a running OpenWaggle process when macOS refused the install for it', () => {
    const outcome = updateInstallOutcome({
      attempt: {
        fromVersion: '1.0.0-beta.8',
        toVersion: '1.0.0-beta.9',
        attemptedAt: localTime('2026-10-05 21:31:20'),
      },
      currentVersion: '1.0.0-beta.8',
      shipItLog: SHIPIT_REFUSED_LOG,
    })

    expect(outcome).toMatchObject({ type: 'failed', version: '1.0.0-beta.9' })
    expect(outcome.type === 'failed' && outcome.message).toContain(
      'another OpenWaggle process was still running',
    )
  })

  it('does not blame an older refusal for a later failed attempt', () => {
    const attemptedAt = localTime('2026-10-05 22:00:00')

    expect(shipItRefusedWhileRunning(SHIPIT_REFUSED_LOG, attemptedAt)).toBe(false)
    expect(
      updateInstallOutcome({
        attempt: { fromVersion: '1.0.0-beta.8', toVersion: '1.0.0-beta.9', attemptedAt },
        currentVersion: '1.0.0-beta.8',
        shipItLog: SHIPIT_REFUSED_LOG,
      }),
    ).toEqual({
      type: 'failed',
      version: '1.0.0-beta.9',
      message: 'Version 1.0.0-beta.9 did not finish installing. Restart to update to try again.',
    })
  })
})
