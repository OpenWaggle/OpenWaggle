import type { ExtensionPackageSummary } from '@shared/types/extensions'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionPackageCard } from '../sections/ExtensionPackageCard'

const PRIVILEGED_PACKAGE = {
  id: 'privileged-extension',
  scope: {
    kind: 'project',
    label: 'Project',
    projectPath: '/tmp/project',
  },
  packagePath: '/tmp/project/.openwaggle/extensions/privileged-extension',
  manifestPath:
    '/tmp/project/.openwaggle/extensions/privileged-extension/openwaggle.extension.json',
  manifest: {
    id: 'privileged-extension',
    name: 'Privileged Extension',
    version: '1.0.0',
    sdkRange: '>=0.1.0 <0.2.0',
    sourceFileCount: 1,
    builtArtifactCount: 2,
    capabilityCount: 1,
    contributionCount: 1,
    piResourceRootCount: 0,
    trustedMain: true,
    trustedRenderer: false,
    runtimeRequirementCount: 1,
  },
  buildPlan: null,
  requirements: {
    runtime: [
      {
        kind: 'runtime-binary',
        id: 'git',
        label: 'Git CLI',
        resolution: 'diagnostic-only',
        binary: 'git',
      },
    ],
    privileges: [
      {
        kind: 'privileged-capability',
        id: 'openwaggle.storage',
        label: 'Capability: openwaggle.storage',
        grantId: 'openwaggle.storage',
        consentRequired: true,
        granted: false,
        capabilityId: 'openwaggle.storage',
        methods: ['get', 'set'],
        scopes: ['project'],
      },
      {
        kind: 'privileged-network',
        id: 'network',
        label: 'Network access',
        grantId: 'network',
        consentRequired: true,
        granted: false,
        origins: ['https://api.github.com'],
        accessModes: ['restricted'],
      },
      {
        kind: 'privileged-trusted-main',
        id: 'trusted-main',
        label: 'Trusted main-process runtime',
        grantId: 'trusted-main',
        consentRequired: true,
        granted: false,
        path: 'dist/main.js',
      },
      {
        kind: 'privileged-local-build',
        id: 'local-build',
        label: 'Local build step',
        grantId: 'local-build',
        consentRequired: true,
        granted: false,
        command: 'pnpm build',
        outputCount: 1,
      },
    ],
    consentRequired: true,
    missingGrantIds: ['openwaggle.storage', 'network', 'trusted-main', 'local-build'],
  },
  contentHash: '1234567890abcdef',
  sdkCompatibility: {
    hostVersion: '0.1.0',
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  lifecycle: null,
  projectOverride: {
    projectPath: '/tmp/project',
    disabled: false,
    updatedAt: null,
  },
  projectOverrides: [
    {
      projectPath: '/tmp/project',
      disabled: false,
      updatedAt: null,
    },
  ],
  diagnostics: [],
} satisfies ExtensionPackageSummary

describe('ExtensionPackageCard requirements', () => {
  it('shows privileged consent details before trust can be granted', () => {
    render(
      <ExtensionPackageCard
        extensionPackage={PRIVILEGED_PACKAGE}
        contributionSummary={null}
        busy={false}
        projectLabel={(projectPath) => projectPath}
        actions={{
          onSetTrusted: vi.fn(),
          onSetEnabled: vi.fn(),
          onSetProjectDisabled: vi.fn(),
          onAcceptUpdate: vi.fn(),
          onApproveBuild: vi.fn(),
          onReload: vi.fn(),
        }}
      />,
    )

    expect(screen.getByText('Extension requirements')).toBeInTheDocument()
    expect(screen.getByText('4 consent pending')).toBeInTheDocument()
    expect(screen.getByText('Capability: openwaggle.storage')).toBeInTheDocument()
    expect(
      screen.getByText('Capability openwaggle.storage; methods get, set; scopes project'),
    ).toBeInTheDocument()
    expect(screen.getByText('Network access')).toBeInTheDocument()
    expect(
      screen.getByText('Origins https://api.github.com; access restricted'),
    ).toBeInTheDocument()
    expect(screen.getByText('Trusted main-process runtime')).toBeInTheDocument()
    expect(screen.getByText('Main-process entry dist/main.js')).toBeInTheDocument()
    expect(screen.getByText('Local build step')).toBeInTheDocument()
    expect(screen.getByText('Build command pnpm build; outputs 1')).toBeInTheDocument()
    expect(screen.getByText('Git CLI')).toBeInTheDocument()
    expect(screen.getByText('Binary: git')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trust Privileged Extension' })).toBeInTheDocument()
  })
})
