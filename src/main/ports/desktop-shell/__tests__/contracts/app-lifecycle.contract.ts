import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { AppLifecycleShape } from '../../app-lifecycle'

export interface AppLifecycleContractHarness {
  readonly subject: AppLifecycleShape
  /** How many times the process really quit (no listener held it). */
  readonly completedQuits: () => number
  /** Makes the shell announce that the platform installer is about to quit the app. */
  readonly announceQuitForUpdate: () => void
}

export const appLifecycleContract = definePortContract<AppLifecycleContractHarness>(
  'AppLifecycle',
  {
    'names the app and its version, and becomes ready': async ({ subject }) => {
      expect(subject.version()).toMatch(/^\d+\.\d+\.\d+/)
      expect(subject.name().length).toBeGreaterThan(0)
      expect(typeof subject.isPackaged()).toBe('boolean')
      await expect(subject.whenReady()).resolves.toBeUndefined()
    },

    'lets a before-quit listener hold the quit until it quits again': async ({
      subject,
      completedQuits,
    }) => {
      let holding = true
      const willQuit: string[] = []
      const stop = subject.onBeforeQuit((event) => {
        if (holding) event.preventDefault()
      })
      const stopWillQuit = subject.onWillQuit(() => willQuit.push('will-quit'))

      subject.quit()
      expect(completedQuits()).toBe(0)
      expect(willQuit).toEqual([])

      holding = false
      subject.quit()
      expect(completedQuits()).toBe(1)
      expect(willQuit).toEqual(['will-quit'])
      stop()
      stopWillQuit()
    },

    'stops calling a listener once it unsubscribed, even twice': async ({
      subject,
      announceQuitForUpdate,
    }) => {
      let calls = 0
      const stop = subject.onBeforeQuitForUpdate(() => {
        calls += 1
      })
      announceQuitForUpdate()
      stop()
      stop()
      announceQuitForUpdate()
      expect(calls).toBe(1)
    },

    'reads back the command-line switches it appended': async ({ subject }) => {
      expect(subject.commandLine.hasSwitch('openwaggle-contract-probe')).toBe(false)
      expect(subject.commandLine.getSwitchValue('openwaggle-contract-probe')).toBe('')
      subject.commandLine.appendSwitch('openwaggle-contract-probe', '42')
      subject.commandLine.appendSwitch('openwaggle-contract-flag')
      expect(subject.commandLine.hasSwitch('openwaggle-contract-probe')).toBe(true)
      expect(subject.commandLine.getSwitchValue('openwaggle-contract-probe')).toBe('42')
      expect(subject.commandLine.hasSwitch('openwaggle-contract-flag')).toBe(true)
    },
  },
)
