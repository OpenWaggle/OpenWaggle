import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { OsShellShape } from '../../os-shell'
import { AUTOMATION_BLOCKED } from './automation'

export interface OsShellContractHarness {
  readonly subject: OsShellShape
  /** What reached the operating system, in order. */
  readonly handedToSystem: () => readonly string[]
  /** Switches on non-disruptive automation, with its window policy installed. */
  readonly enterAutomation: () => void
}

export const osShellContract = definePortContract<OsShellContractHarness>('OsShell', {
  'hands URLs and files to the operating system': async ({ subject, handedToSystem }) => {
    await subject.openExternal('https://openwaggle.ai/')
    await expect(subject.openPath('/tmp/report.txt')).resolves.toBe('')
    subject.showItemInFolder('/tmp/report.txt')
    await subject.trashItem('/tmp/old.txt')
    expect(handedToSystem()).toEqual([
      'https://openwaggle.ai/',
      '/tmp/report.txt',
      '/tmp/report.txt',
      '/tmp/old.txt',
    ])
  },

  'reports a path it could not open, and rejects a refused trash': async ({ subject }) => {
    await expect(subject.openPath('/tmp/missing-file')).resolves.not.toBe('')
    await expect(subject.trashItem('/tmp/missing-file')).rejects.toThrow()
  },

  'launches nothing under automation': async ({ subject, handedToSystem, enterAutomation }) => {
    enterAutomation()
    await expect(subject.openExternal('https://openwaggle.ai/')).rejects.toMatchObject(
      AUTOMATION_BLOCKED,
    )
    await expect(subject.openPath('/tmp/a')).rejects.toMatchObject(AUTOMATION_BLOCKED)
    await expect(subject.trashItem('/tmp/a')).rejects.toMatchObject(AUTOMATION_BLOCKED)
    expect(() => subject.showItemInFolder('/tmp/a')).toThrow(
      expect.objectContaining(AUTOMATION_BLOCKED),
    )
    expect(() => subject.beep()).toThrow(expect.objectContaining(AUTOMATION_BLOCKED))
    expect(handedToSystem()).toEqual([])
  },
})
