import { describe, expect, it } from 'vitest'
import { unixSessionHostEndpoint } from '../local-session-host-layout'
import { resolveLocalSessionHostPaths } from '../local-session-paths'

const TEMPORARY_ROOT = '/var/folders/xy/T'

/*
 * The boot shim finds the Host socket with the layout alone, before the main bundle loads; the
 * Host listens where `resolveLocalSessionHostPaths` says. They must agree for every profile path.
 */
describe('Session Host socket layout', () => {
  it.each([
    [
      'a short profile, in its state directory',
      '/Users/person/Library/Application Support/openwaggle',
    ],
    [
      'a long profile, in the Host temp directory',
      `/Users/person/${'nested/'.repeat(12)}openwaggle`,
    ],
  ])('places %s where the Host listens', (_case, userDataRoot) => {
    const paths = resolveLocalSessionHostPaths({
      userDataRoot,
      platform: 'darwin',
      temporaryRoot: TEMPORARY_ROOT,
    })

    expect(unixSessionHostEndpoint(userDataRoot, () => TEMPORARY_ROOT)).toEqual({
      endpoint: paths.endpoint,
      endpointDirectory: paths.endpointDirectory,
    })
  })

  it('falls back to /tmp when even the temp directory path is too long for a socket', () => {
    const longTemporaryRoot = `/private/var/${'deep/'.repeat(16)}T`
    const userDataRoot = `/Users/person/${'nested/'.repeat(12)}openwaggle`

    const { endpoint } = unixSessionHostEndpoint(userDataRoot, () => longTemporaryRoot)

    expect(endpoint).toMatch(/^\/tmp\/owsh-[0-9a-f]{20}\/host\.sock$/u)
    expect(endpoint).toBe(
      resolveLocalSessionHostPaths({
        userDataRoot,
        platform: 'darwin',
        temporaryRoot: longTemporaryRoot,
      }).endpoint,
    )
  })
})
