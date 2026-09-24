import { describe, expect, it } from 'vitest'
import {
  collectPiRuntimeAlignmentProblems,
  type PiRuntimeAlignmentInput,
} from '../check-pi-runtime-alignment'

const version = '0.87.1'
const packages = [
  'pi-agent-core',
  'pi-ai',
  'pi-client',
  'pi-coding-agent',
  'pi-protocol',
  'pi-telemetry',
  'pi-tui',
]
const installedPackages = ['pi-agent-core', 'pi-ai', 'pi-coding-agent', 'pi-telemetry', 'pi-tui']

function alignedInput(): PiRuntimeAlignmentInput {
  const packageRef = (name: string) => `@earendil-works/${name}`
  const piAiPatch = `@earendil-works__pi-ai@${version}.patch`
  const piCodingAgentPatch = `@earendil-works__pi-coding-agent@${version}.patch`
  return {
    workspace: `catalogs:
  pi-runtime:
${packages.map((name) => `    "${packageRef(name)}": ${version}`).join('\n')}
minimumReleaseAgeExclude:
${packages.map((name) => `  - ${packageRef(name)}@${version}`).join('\n')}
patchedDependencies:
  '${packageRef('pi-ai')}@${version}': patches/@earendil-works__pi-ai@${version}.patch
  '${packageRef('pi-coding-agent')}@${version}': patches/@earendil-works__pi-coding-agent@${version}.patch
`,
    lockfile: `${installedPackages.map((name) => `${packageRef(name)}@${version}`).join('\n')}
  '${packageRef('pi-ai')}@${version}': abc123
  '${packageRef('pi-coding-agent')}@${version}': def456
`,
    patchContents: {
      [piAiPatch]: 'diff --git a/dist/types.d.ts b/dist/types.d.ts',
      [piCodingAgentPatch]: 'diff --git a/dist/core/agent-session.js b/dist/core/agent-session.js',
    },
    patchFiles: [piAiPatch, piCodingAgentPatch],
    rootDependencies: {
      [packageRef('pi-ai')]: 'catalog:pi-runtime',
      [packageRef('pi-coding-agent')]: 'catalog:pi-runtime',
    },
    piWaggleDevDependencies: {
      [packageRef('pi-coding-agent')]: 'catalog:pi-runtime',
      [packageRef('pi-tui')]: 'catalog:pi-runtime',
    },
  }
}

describe('Pi runtime alignment', () => {
  it('accepts aligned non-runtime catalog packages absent from the lockfile', () => {
    expect(collectPiRuntimeAlignmentProblems(alignedInput())).toEqual([])
  })

  it('accepts all release-age exclusions being removed after they expire', () => {
    const input = alignedInput()
    const workspace = input.workspace.replace(
      packages.map((name) => `  - @earendil-works/${name}@${version}`).join('\n'),
      '',
    )
    expect(collectPiRuntimeAlignmentProblems({ ...input, workspace })).toEqual([])
  })

  it.each([
    {
      drift: 'catalog',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        workspace: input.workspace.replace(`"@earendil-works/pi-tui": ${version}`, '"@earendil-works/pi-tui": 0.86.0'),
      }),
      expected: 'must use 0.87.1 in catalogs.pi-runtime',
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
      drift: 'release-age exclusion',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        workspace: input.workspace.replace(`  - @earendil-works/pi-tui@${version}\n`, ''),
      }),
      expected: 'minimumReleaseAgeExclude must be empty or contain the seven matched Pi packages',
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
      expected: '@earendil-works/pi-telemetry lockfile versions must align at 0.87.1',
    },
    {
      drift: 'multiple lockfile versions',
      breakInput: (input: PiRuntimeAlignmentInput) => ({
        ...input,
        lockfile: `${input.lockfile}\n@earendil-works/pi-ai@0.86.0`,
      }),
      expected: '@earendil-works/pi-ai lockfile versions must align at 0.87.1',
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
      expected: 'pnpm-workspace.yaml must register the 0.87.1 pi-ai patch',
    },
  ])('detects $drift drift', ({ breakInput, expected }) => {
    expect(collectPiRuntimeAlignmentProblems(breakInput(alignedInput()))).toContainEqual(
      expect.stringContaining(expected),
    )
  })
})
