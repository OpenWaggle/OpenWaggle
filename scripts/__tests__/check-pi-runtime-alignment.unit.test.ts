import { describe, expect, it } from 'vitest'
import {
  collectPiRuntimeAlignmentProblems,
  type PiRuntimeAlignmentInput,
} from '../check-pi-runtime-alignment'
import { alignedInput, version } from './pi-runtime-alignment.test-support'

describe('Pi runtime alignment', () => {
  it('accepts aligned non-runtime catalog packages absent from the lockfile', () => {
    expect(collectPiRuntimeAlignmentProblems(alignedInput())).toEqual([])
  })

  it.each([
    {
      drift: 'catalog',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        workspace: input.workspace.replace(`"@earendil-works/pi-tui": ${version}`, '"@earendil-works/pi-tui": 0.86.0'),
      }),
      expected: 'must use 1.0.4 in catalogs.pi-runtime',
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
        lockfile: `${input.lockfile}  quickjs-wasi@3.7.0:\n`,
      }),
      expected: 'pnpm-lock.yaml must resolve exactly one quickjs-wasi version',
    },
    {
      drift: 'release-age exclusion',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        workspace: input.workspace.replace(`  - @earendil-works/pi-tui@${version}\n`, ''),
      }),
      expected: 'minimumReleaseAgeExclude must be empty or contain exactly the 8 matched Pi packages',
    },
    {
      drift: 'release-age exclusion for a package the lockfile does not resolve',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        workspace: input.workspace.replace(
          `  - @earendil-works/pi-tui@${version}\n`,
          `  - @earendil-works/pi-tui@${version}\n  - @earendil-works/pi-client@${version}\n`,
        ),
      }),
      expected: 'unneeded @earendil-works/pi-client@1.0.4',
    },
    {
      drift: 'missing chord release-age exclusion',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        workspace: input.workspace.replace(`  - @earendil-works/chord@${version}\n`, ''),
      }),
      expected: 'missing @earendil-works/chord@1.0.4',
    },
    {
      drift: 'chord lockfile version',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: input.lockfile.replace(
          `@earendil-works/chord@${version}`,
          '@earendil-works/chord@0.87.1',
        ),
      }),
      expected: '@earendil-works/chord lockfile versions must align at 1.0.4',
    },
    {
      drift: 'lockfile version',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: input.lockfile.replace(
          `@earendil-works/pi-telemetry@${version}`,
          '@earendil-works/pi-telemetry@0.86.0',
        ),
      }),
      expected: '@earendil-works/pi-telemetry lockfile versions must align at 1.0.4',
    },
    {
      drift: 'multiple lockfile versions',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: `${input.lockfile}\n@earendil-works/pi-ai@0.86.0`,
      }),
      expected: '@earendil-works/pi-ai lockfile versions must align at 1.0.4',
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
        workspace: input.workspace.replace(
          `patches/@earendil-works__pi-ai@${version}.patch`,
          'patches/@earendil-works__pi-ai@0.86.0.patch',
        ),
      }),
      expected: 'pnpm-workspace.yaml must register the 1.0.4 pi-ai patch',
    },
  ])('detects $drift drift', ({ breakInput, expected }) => {
    expect(collectPiRuntimeAlignmentProblems(breakInput(alignedInput()))).toContainEqual(
      expect.stringContaining(expected),
    )
  })
})
