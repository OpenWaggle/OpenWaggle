import type { PiRuntimeAlignmentInput } from '../check-pi-runtime-alignment'

/** An input every Pi runtime alignment check accepts, at Pi 1.2.0 with release-age exclusions. */

export const version = '1.2.0'
const packages = [
  'pi-agent-core',
  'pi-ai',
  'pi-codemode',
  'pi-coding-agent',
  'pi-mcp',
  'pi-telemetry',
  'pi-tui',
]
/** The matched release packages the lockfile resolves: the catalog's, as of Pi 1.2.0. */
export const installedPackages = [
  'pi-agent-core',
  'pi-ai',
  'pi-codemode',
  'pi-coding-agent',
  'pi-mcp',
  'pi-telemetry',
  'pi-tui',
]

export function alignedInput(): PiRuntimeAlignmentInput {
  const packageRef = (name: string) => `@earendil-works/${name}`
  const piAiPatch = `@earendil-works__pi-ai@${version}.patch`
  const piCodingAgentPatch = `@earendil-works__pi-coding-agent@${version}.patch`
  return {
    workspace: `catalogs:
  pi-runtime:
${packages.map((name) => `    "${packageRef(name)}": ${version}`).join('\n')}
minimumReleaseAgeExclude:
  # pi-runtime-release-age-exclusions-expire: 2026-10-19T23:04:00Z
${installedPackages.map((name) => `  - "${packageRef(name)}@${version}"`).join('\n')}
patchedDependencies:
  '${packageRef('pi-ai')}@${version}': patches/@earendil-works__pi-ai@${version}.patch
  '${packageRef('pi-coding-agent')}@${version}': patches/@earendil-works__pi-coding-agent@${version}.patch
`,
    lockfile: `${installedPackages.map((name) => `${packageRef(name)}@${version}`).join('\n')}
  quickjs-wasi@3.6.2:
  '@silvia-odwyer/photon-node@0.3.4':
  '${packageRef('pi-ai')}@${version}': abc123
  '${packageRef('pi-coding-agent')}@${version}': def456
`,
    patchContents: {
      [piAiPatch]: 'diff --git a/dist/providers/compat-schema.d.ts b/dist/providers/compat-schema.d.ts',
      [piCodingAgentPatch]: 'diff --git a/dist/core/agent-session.js b/dist/core/agent-session.js',
    },
    patchFiles: [piAiPatch, piCodingAgentPatch],
    rootDependencies: {
      [packageRef('pi-ai')]: 'catalog:pi-runtime',
      [packageRef('pi-coding-agent')]: 'catalog:pi-runtime',
      [packageRef('pi-mcp')]: 'catalog:pi-runtime',
      'quickjs-wasi': '3.6.2',
      '@silvia-odwyer/photon-node': '0.3.4',
    },
    now: new Date('2026-10-14T12:00:00Z'),
    piWaggleDevDependencies: {
      [packageRef('pi-coding-agent')]: 'catalog:pi-runtime',
      [packageRef('pi-tui')]: 'catalog:pi-runtime',
    },
  }
}

