import { describe, expect, it } from 'vitest'
import { COMMON_DEV_PORTS } from '../terminal-port-preview-probes'
import {
  parsePosixListeningPortOutput,
  parseWindowsListeningPortOutput,
  terminalPortCandidatesForScan,
} from '../terminal-process-ports'

describe('terminal listening port discovery', () => {
  it('retains concrete POSIX listener hosts and normalizes wildcard hosts', () => {
    const scan = parsePosixListeningPortOutput(
      [
        'p100',
        'n127.0.0.1:5173',
        'n[::1]:5174',
        'p200',
        'n*:3000',
        'n192.168.1.20:8080 (LISTEN)',
      ].join('\n'),
    )

    expect(scan.portsByPid).toEqual(
      new Map([
        [100, [5173, 5174]],
        [200, [3000, 8080]],
      ]),
    )
    expect(scan.candidates).toEqual([
      { host: '127.0.0.1', port: 5173, pid: 100 },
      { host: '::1', port: 5174, pid: 100 },
      { host: 'localhost', port: 3000, pid: 200 },
      { host: '192.168.1.20', port: 8080, pid: 200 },
    ])
  })

  it('parses IPv4 and IPv6 Windows listeners without confusing remote endpoints', () => {
    const scan = parseWindowsListeningPortOutput(
      ['127.0.0.1|4173|42', '::|8080|43', 'malformed PowerShell output'].join('\r\n'),
    )

    expect(scan.candidates).toEqual([
      { host: '127.0.0.1', port: 4173, pid: 42 },
      { host: 'localhost', port: 8080, pid: 43 },
    ])
  })

  it('uses common dev ports only when listener discovery is unavailable', () => {
    expect(terminalPortCandidatesForScan(null).map((candidate) => candidate.port)).toEqual(
      COMMON_DEV_PORTS,
    )
    expect(terminalPortCandidatesForScan({ candidates: [], portsByPid: new Map() })).toEqual([])
  })
})
