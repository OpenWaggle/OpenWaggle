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

/** A registry package entry of a parsed `bun.lock`. */
export function lockedPackage(name: string, lockedVersion: string) {
  return { key: name, name, version: lockedVersion, integrity: undefined }
}

export function alignedInput(): PiRuntimeAlignmentInput {
  const packageRef = (name: string) => `@earendil-works/${name}`
  const piAiPatch = `@earendil-works__pi-ai@${version}.patch`
  const piCodingAgentPatch = `@earendil-works__pi-coding-agent@${version}.patch`
  const patchRegistrations = {
    [`${packageRef('pi-ai')}@${version}`]: `patches/${piAiPatch}`,
    [`${packageRef('pi-coding-agent')}@${version}`]: `patches/${piCodingAgentPatch}`,
  }
  return {
    bunfig: `[install]
minimumReleaseAgeExcludes = [
  # pi-runtime-release-age-exclusions-expire: 2026-10-19T23:04:00Z
${installedPackages.map((name) => `  "${packageRef(name)}@${version}",`).join('\n')}
]
`,
    catalogs: {
      'pi-runtime': Object.fromEntries(packages.map((name) => [packageRef(name), version])),
      'pi-extension-host': { typebox: '1.3.27' },
    },
    patchedDependencies: patchRegistrations,
    lockfile: {
      packages: [
        ...installedPackages.map((name) => lockedPackage(packageRef(name), version)),
        lockedPackage('quickjs-wasi', '3.6.2'),
        lockedPackage('@silvia-odwyer/photon-node', '0.3.4'),
      ],
      patchedDependencies: patchRegistrations,
      catalogs: {},
    },
    patchContents: {
      [piAiPatch]:
        'diff --git a/dist/providers/compat-schema.d.ts b/dist/providers/compat-schema.d.ts',
      [piCodingAgentPatch]: 'diff --git a/dist/core/agent-session.js b/dist/core/agent-session.js',
    },
    patchFiles: [piAiPatch, piCodingAgentPatch],
    piCodingAgentDependencies: { typebox: '1.3.27' },
    rootDependencies: {
      [packageRef('pi-ai')]: 'catalog:pi-runtime',
      [packageRef('pi-coding-agent')]: 'catalog:pi-runtime',
      [packageRef('pi-mcp')]: 'catalog:pi-runtime',
      'quickjs-wasi': '3.6.2',
      '@silvia-odwyer/photon-node': '0.3.4',
      typebox: 'catalog:pi-extension-host',
    },
    now: new Date('2026-10-14T12:00:00Z'),
    piWaggleDevDependencies: {
      [packageRef('pi-coding-agent')]: 'catalog:pi-runtime',
      [packageRef('pi-tui')]: 'catalog:pi-runtime',
      typebox: 'catalog:pi-extension-host',
    },
  }
}
