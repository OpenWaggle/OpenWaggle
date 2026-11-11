import { describe, expect, it } from 'vitest'
import { parseLinuxStat } from '../posix-kernel-linux'

const BOOT_ID = 'b0b0-1'

describe('parseLinuxStat', () => {
  it('reads a process whose command name holds spaces and parentheses', () => {
    const stat =
      '4242 (my (odd) shell) S 4200 4242 4242 34816 4250 4194304 1 0 0 0 0 0 0 0 20 0 1 0 987654 1000 10 18446744073709551615'
    expect(parseLinuxStat(stat, BOOT_ID, 4242)).toEqual({
      pid: 4242,
      startedAt: 'linux:b0b0-1:987654',
      ppid: 4200,
      pgid: 4242,
      tpgid: 4250,
      ttyIdentity: 'linux:136:0',
      zombie: false,
      name: 'my (odd) shell',
    })
  })

  it('reports a zombie without a controlling terminal', () => {
    const stat = '77 (sh) Z 1 77 77 0 -1 4194304 1 0 0 0 0 0 0 0 20 0 1 0 5 0 0'
    expect(parseLinuxStat(stat, BOOT_ID, 77)).toMatchObject({
      zombie: true,
      ttyIdentity: null,
      tpgid: -1,
    })
  })

  it('splits the device number into its major and minor parts', () => {
    // pts/300: major 136, minor 300 (low byte 44, high bits 1 << 8 shifted by 12).
    const ttyNr = (136 << 8) | 44 | (1 << 20)
    const stat = `9 (bash) S 1 9 9 ${String(ttyNr)} 9 0 0 0 0 0 0 0 0 0 20 0 1 0 12 0 0`
    expect(parseLinuxStat(stat, BOOT_ID, 9)?.ttyIdentity).toBe('linux:136:300')
  })

  it('rejects a truncated stat line', () => {
    expect(parseLinuxStat('12 (sh) S 1 12', BOOT_ID, 12)).toBeNull()
    expect(parseLinuxStat('garbage', BOOT_ID, 12)).toBeNull()
  })
})
