import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { SecondInstanceLaunch, SystemIntegrationShape } from '../../system-integration'

export interface SystemIntegrationContractHarness {
  readonly subject: SystemIntegrationShape
  /** Another running instance holds the single-instance lock from now on. */
  readonly anotherInstanceRuns: () => void
  /** A later launch reaches this instance. */
  readonly launchAgain: (launch: SecondInstanceLaunch) => void
  readonly wakeFromSleep: () => void
  /** The system opens an `openwaggle:` link (macOS). */
  readonly openUrl: (url: string) => void
}

export const systemIntegrationContract = definePortContract<SystemIntegrationContractHarness>(
  'SystemIntegration',
  {
    'holds the single-instance lock until it releases it': async ({ subject }) => {
      expect(subject.requestSingleInstanceLock({ probe: 'contract' })).toBe(true)
      expect(subject.hasSingleInstanceLock()).toBe(true)
      subject.releaseSingleInstanceLock()
      expect(subject.hasSingleInstanceLock()).toBe(false)
    },

    'refuses the lock while another instance runs': async ({ subject, anotherInstanceRuns }) => {
      anotherInstanceRuns()
      expect(subject.requestSingleInstanceLock()).toBe(false)
    },

    'delivers later launches, wake-ups and links until unsubscribed': async ({
      subject,
      launchAgain,
      wakeFromSleep,
      openUrl,
    }) => {
      const seen: string[] = []
      const stops = [
        subject.onSecondInstance((launch) => seen.push(`launch ${launch.argv.join(' ')}`)),
        subject.onResume(() => seen.push('resume')),
        subject.onOpenUrl((event, url) => {
          event.preventDefault()
          seen.push(url)
        }),
      ]
      launchAgain({ argv: ['openwaggle', '/project'], workingDirectory: '/', additionalData: {} })
      wakeFromSleep()
      openUrl('openwaggle://sessions/s-1')
      for (const stop of stops) stop()
      launchAgain({ argv: ['late'], workingDirectory: '/', additionalData: {} })
      wakeFromSleep()
      openUrl('openwaggle://sessions/s-2')
      expect(seen).toEqual(['launch openwaggle /project', 'resume', 'openwaggle://sessions/s-1'])
    },

    'remembers whether a login item opens at login': async ({ subject }) => {
      const item = { path: '/Applications/OpenWaggle.app', args: ['--hidden'] }
      subject.setLoginItemOpensAtLogin(item, true)
      expect(subject.loginItemOpensAtLogin(item)).toBe(true)
      subject.setLoginItemOpensAtLogin(item, false)
      expect(subject.loginItemOpensAtLogin(item)).toBe(false)
    },
  },
)
