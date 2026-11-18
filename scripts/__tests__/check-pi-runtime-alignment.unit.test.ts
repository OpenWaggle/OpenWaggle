import { describe, expect, it } from 'vitest'
import {
  collectPiRuntimeAlignmentProblems,
  type PiRuntimeAlignmentInput,
} from '../check-pi-runtime-alignment'
import { alignedInput, lockedPackage, version } from './pi-runtime-alignment.test-support'

describe('Pi runtime alignment', () => {
  it('accepts aligned non-runtime catalog packages absent from the lockfile', () => {
    expect(collectPiRuntimeAlignmentProblems(alignedInput())).toEqual([])
  })

  it.each([
    {
      drift: 'catalog',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        catalogs: {
          ...input.catalogs,
          'pi-runtime': { ...input.catalogs['pi-runtime'], '@earendil-works/pi-tui': '0.86.0' },
        },
      }),
      expected: 'must use 1.2.0 in catalogs.pi-runtime',
    },
    {
      drift: 'direct pin',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        rootDependencies: { ...input.rootDependencies, '@earendil-works/pi-ai': version },
      }),
      expected: 'package.json must pin @earendil-works/pi-ai through catalog:pi-runtime',
    },
    {
      drift: 'pi-mcp direct pin',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        rootDependencies: { ...input.rootDependencies, '@earendil-works/pi-mcp': version },
      }),
      expected: 'package.json must pin @earendil-works/pi-mcp through catalog:pi-runtime',
    },
    {
      drift: 'QuickJS wasm version',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        rootDependencies: { ...input.rootDependencies, 'quickjs-wasi': '3.6.1' },
      }),
      expected: "package.json must pin quickjs-wasi at Pi codemode's 3.6.2",
    },
    {
      drift: 'Photon wasm version',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        rootDependencies: { ...input.rootDependencies, '@silvia-odwyer/photon-node': '0.3.3' },
      }),
      expected: "package.json must pin @silvia-odwyer/photon-node at Pi coding agent's 0.3.4",
    },
    {
      drift: 'second QuickJS version',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: {
          ...input.lockfile,
          packages: [...input.lockfile.packages, lockedPackage('quickjs-wasi', '3.7.0')],
        },
      }),
      expected: 'bun.lock must resolve exactly one quickjs-wasi version',
    },
    {
      drift: 'release-age exclusion',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        bunfig: input.bunfig.replace(`  "@earendil-works/pi-tui@${version}",\n`, ''),
      }),
      expected:
        'minimumReleaseAgeExcludes must be empty or contain exactly the 7 matched Pi packages',
    },
    {
      drift: 'release-age exclusion for a package the lockfile does not resolve',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        bunfig: input.bunfig.replace(
          `  "@earendil-works/pi-tui@${version}",\n`,
          `  "@earendil-works/pi-tui@${version}",\n  "@earendil-works/pi-client@${version}",\n`,
        ),
      }),
      expected: 'unneeded @earendil-works/pi-client@1.2.0',
    },
    {
      drift: 'missing release-age exclusion',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        bunfig: input.bunfig.replace(`  "@earendil-works/pi-mcp@${version}",\n`, ''),
      }),
      expected: 'missing @earendil-works/pi-mcp@1.2.0',
    },
    {
      drift: 'catalog entry for a package Pi no longer releases',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        catalogs: {
          ...input.catalogs,
          'pi-runtime': { ...input.catalogs['pi-runtime'], '@earendil-works/pi-client': '1.1.0' },
        },
      }),
      expected: '@earendil-works/pi-client is no longer part of the Pi release',
    },
    {
      drift: 'lockfile entry for a package Pi no longer releases',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: {
          ...input.lockfile,
          packages: [...input.lockfile.packages, lockedPackage('@earendil-works/chord', '1.2.0')],
        },
      }),
      expected: 'bun.lock still resolves @earendil-works/chord',
    },
    {
      drift: 'lockfile version',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: {
          ...input.lockfile,
          packages: input.lockfile.packages.map((entry) =>
            entry.name === '@earendil-works/pi-telemetry' ? { ...entry, version: '0.86.0' } : entry,
          ),
        },
      }),
      expected: '@earendil-works/pi-telemetry lockfile versions must align at 1.2.0',
    },
    {
      drift: 'multiple lockfile versions',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: {
          ...input.lockfile,
          packages: [...input.lockfile.packages, lockedPackage('@earendil-works/pi-ai', '0.86.0')],
        },
      }),
      expected: '@earendil-works/pi-ai lockfile versions must align at 1.2.0',
    },
    {
      drift: 'unexpected patch path',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        patchContents: {
          ...input.patchContents,
          [`@earendil-works__pi-coding-agent@${version}.patch`]:
            'diff --git a/examples/damaged.ts b/examples/damaged.ts',
        },
      }),
      expected: 'may only change the expected dist files',
    },
    {
      drift: 'conflict-marker damage',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        patchContents: {
          ...input.patchContents,
          [`@earendil-works__pi-ai@${version}.patch`]:
            'diff --git a/dist/types.d.ts b/dist/types.d.ts\n+<<<<<<< ours',
        },
      }),
      expected: 'contains added conflict markers',
    },
    {
      drift: 'patch registration',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        patchedDependencies: {
          ...input.patchedDependencies,
          [`@earendil-works/pi-ai@${version}`]: 'patches/@earendil-works__pi-ai@0.86.0.patch',
        },
      }),
      expected: 'package.json patchedDependencies must register the 1.2.0 pi-ai patch',
    },
    {
      drift: 'lockfile patch registration',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: { ...input.lockfile, patchedDependencies: {} },
      }),
      expected: 'bun.lock must register the 1.2.0 pi-coding-agent patch',
    },
  ])('detects $drift drift', ({ breakInput, expected }) => {
    expect(collectPiRuntimeAlignmentProblems(breakInput(alignedInput()))).toContainEqual(
      expect.stringContaining(expected),
    )
  })

  it('pins the pi-extension-host catalog at the typebox Pi supplies to extensions', () => {
    const input = alignedInput()
    expect(
      collectPiRuntimeAlignmentProblems({
        ...input,
        piCodingAgentDependencies: { typebox: '1.3.32' },
      }),
    ).toContainEqual("catalogs.pi-extension-host must pin typebox at pi-coding-agent's 1.3.32.")
    expect(
      collectPiRuntimeAlignmentProblems({ ...input, piCodingAgentDependencies: {} }),
    ).toContainEqual(
      'pi-coding-agent no longer depends on typebox; update catalogs.pi-extension-host.',
    )
  })

  it('requires the app and pi-waggle to take typebox from the pi-extension-host catalog', () => {
    const input = alignedInput()
    expect(
      collectPiRuntimeAlignmentProblems({
        ...input,
        rootDependencies: { ...input.rootDependencies, typebox: '1.3.27' },
        piWaggleDevDependencies: { ...input.piWaggleDevDependencies, typebox: '1.3.33' },
      }),
    ).toEqual([
      'package.json must take typebox from catalog:pi-extension-host.',
      'packages/pi-waggle/package.json must take typebox from catalog:pi-extension-host.',
    ])
  })
})
