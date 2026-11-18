import { describe, expect, it } from 'vitest'
import { nativeLoadProbeBundlePath } from '../native-load-probe-bundle'
import { nodeScriptBuildInvocation, nodeScriptBundlePath } from '../node-script-bundle'

describe('Node script bundles', () => {
  it('bundles a script for Node into the OpenWaggle cache, named after its source', () => {
    expect(nodeScriptBundlePath('/repo', 'scripts/mcp-conformance-client.mts', 'darwin')).toBe(
      '/repo/node_modules/.cache/openwaggle/mcp-conformance-client.mjs',
    )
    expect(nativeLoadProbeBundlePath('C:\\repo', 'win32')).toBe(
      'C:\\repo\\node_modules\\.cache\\openwaggle\\native-load-probe.mjs',
    )
    expect(
      nodeScriptBuildInvocation('/repo', 'scripts/native-load-probe.ts', 'linux', '/bin/bun'),
    ).toEqual({
      command: '/bin/bun',
      args: [
        'build',
        '/repo/scripts/native-load-probe.ts',
        '--target=node',
        '--format=esm',
        '--outfile',
        '/repo/node_modules/.cache/openwaggle/native-load-probe.mjs',
      ],
    })
  })
})
