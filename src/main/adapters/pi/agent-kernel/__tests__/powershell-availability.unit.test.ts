import { getPowerShellConfig } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { offersPowerShellTool } from '../powershell-availability'

describe('offersPowerShellTool', () => {
  it('offers PowerShell on Windows', () => {
    expect(offersPowerShellTool('win32')).toBe(true)
  })

  it('leaves PowerShell out on macOS and Linux, even with pwsh installed', () => {
    expect(offersPowerShellTool('darwin')).toBe(false)
    expect(offersPowerShellTool('linux')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'matches Pi, whose powershell tool cannot run outside Windows',
    () => {
      expect(() => getPowerShellConfig()).toThrow(/only available on Windows/)
    },
  )
})
