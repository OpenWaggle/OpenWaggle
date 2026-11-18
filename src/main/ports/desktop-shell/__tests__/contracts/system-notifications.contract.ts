import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { SystemNotificationsShape } from '../../system-notifications'

export interface SystemNotificationsContractHarness {
  readonly subject: SystemNotificationsShape
  /** Titles of the notifications the system showed. */
  readonly shownTitles: () => readonly string[]
  /** Clicks the notification the system showed last. */
  readonly clickLast: () => void
  readonly enterAutomation: () => void
}

const REQUEST = {
  id: 'run-1',
  groupId: 'session-1',
  title: 'Run finished',
  body: 'Done',
  silent: true,
}

export const systemNotificationsContract = definePortContract<SystemNotificationsContractHarness>(
  'SystemNotifications',
  {
    'shows a notification and reports its click': async ({ subject, shownTitles, clickLast }) => {
      expect(subject.isSupported()).toBe(true)
      const clicks: string[] = []
      const handle = subject.show(REQUEST, { onClick: () => clicks.push('click') })
      expect(handle).not.toBeNull()
      expect(shownTitles()).toEqual(['Run finished'])
      clickLast()
      expect(clicks).toEqual(['click'])
      handle?.close()
    },

    'never reaches the desktop under automation': async ({
      subject,
      shownTitles,
      enterAutomation,
    }) => {
      enterAutomation()
      expect(subject.isSupported()).toBe(false)
      expect(subject.show(REQUEST)).toBeNull()
      expect(() => subject.removeDelivered('run-1')).not.toThrow()
      expect(shownTitles()).toEqual([])
    },
  },
)
