import { describe, expect, it } from 'vitest'
import { WINDOWS_PIPE_SECURITY_SOURCE } from '../windows-pipe-security-source'
import {
  windowsPipeDescriptorProbeScript,
  windowsPipeReadbackProbeScript,
} from './windows-pipe-readback-probe'

describe('Windows pipe instance security regression probe', () => {
  it('uses the production DACL validator but cannot reapply protection from the probe entrypoint', () => {
    const script = windowsPipeReadbackProbeScript()
    expect(script).toContain(WINDOWS_PIPE_SECURITY_SOURCE)
    const probe = script.replace(WINDOWS_PIPE_SECURITY_SOURCE, '')

    expect(probe).toContain('OpenWagglePipeSecurity.VerifyHandle(handle)')
    expect(probe).toContain('0x00020000 /* READ_CONTROL only */')
    expect(probe).not.toContain('SetSecurityInfo')
    expect(probe).not.toContain('ProtectAndVerify')
    expect(probe).not.toContain('WRITE_DAC')
    expect(probe).not.toContain('WRITE_OWNER')
  })

  it('holds more than libuv’s four pending instances and verifies a replacement batch', () => {
    const script = windowsPipeReadbackProbeScript()

    expect(script).toContain(
      '$first = [OpenWagglePipeReadbackProbe]::VerifyInstances($pipePath, 8)',
    )
    expect(script).toContain(
      '$replacement = [OpenWagglePipeReadbackProbe]::VerifyInstances($pipePath, 8)',
    )
    expect(script).toContain('handles.Add(handle)')
    expect(script).toContain(
      'finally\n        {\n            foreach (var handle in handles) handle.Dispose();',
    )
    expect(script.indexOf('handles.Add(handle)')).toBeLessThan(
      script.indexOf('foreach (var handle in handles) handle.Dispose()'),
    )
  })

  it('validates descriptor fixtures with the production checker and the Windows full-control enum', () => {
    const script = windowsPipeDescriptorProbeScript()
    const probe = script.replace(WINDOWS_PIPE_SECURITY_SOURCE, '')

    expect(probe).toContain('[System.IO.Pipes.PipeAccessRights]::FullControl')
    expect(probe).toContain('[OpenWagglePipeSecurity]::VerifyDescriptor($descriptor, $owner)')
    expect(probe).not.toContain('ProtectAndVerify')
    expect(probe).not.toContain('SetSecurityInfo')
    expect(probe.indexOf('RawSecurityDescriptor($sddl)')).toBeLessThan(probe.indexOf('try {'))
  })

  it('keeps both encoded probes within the Windows command-line limit', () => {
    for (const script of [windowsPipeReadbackProbeScript(), windowsPipeDescriptorProbeScript()]) {
      expect(Buffer.from(script, 'utf16le').toString('base64').length).toBeLessThan(32_000)
    }
  })
})
