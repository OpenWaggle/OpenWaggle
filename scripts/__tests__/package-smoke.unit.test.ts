import { describe, expect, it } from 'vitest'
import {
  assertDualModuleExports,
  assertBrowserBundleContent,
  assertPackedPackageMetadata,
  assertPackedPackageFiles,
  assertPackedWorkspaceDependencyRanges,
  assertReactPeerDependencies,
  collectManifestPackagePaths,
  parsePnpmPackTarballPath,
  supportsPackageSmokeNodeVersion,
} from '../package-smoke-assertions'
import {
  createSmokePackageJson,
  packageManagerInstallArgs,
} from '../package-smoke'
import {
  assertRequiredPackageManagers,
  availablePackageManagers,
} from '../package-smoke-package-managers'

describe('package smoke tarball assertions', () => {
  it('probes package managers outside the repository and fails closed for required managers', async () => {
    const probeDirectories: string[] = []
    const available = await availablePackageManagers(
      [
        { name: 'npm', command: 'npm' },
        { name: 'yarn', command: 'yarn' },
      ],
      async (_candidate, cwd) => {
        probeDirectories.push(cwd)
      },
      '/tmp/openwaggle-package-manager-probe',
    )

    expect(available.map(({ name }) => name)).toEqual(['npm', 'yarn'])
    expect(probeDirectories).toEqual([
      '/tmp/openwaggle-package-manager-probe',
      '/tmp/openwaggle-package-manager-probe',
    ])
    expect(() => assertRequiredPackageManagers(available, ['npm', 'yarn'])).not.toThrow()
    expect(() => assertRequiredPackageManagers(available, ['npm', 'pnpm', 'yarn'])).toThrow(
      'Required package consumers are unavailable: pnpm.',
    )
  })

  it('creates a self-contained TypeScript consumer project manifest', () => {
    const manifest = createSmokePackageJson(
      [{ name: '@openwaggle/extension-sdk', tarballPath: '/tmp/extension-sdk.tgz' }],
      [
        { name: '@earendil-works/pi-coding-agent', version: '1.0.0' },
        { name: '@earendil-works/pi-tui', version: '1.0.0' },
        { name: '@types/node', version: '24.0.0' },
        { name: '@types/react', version: '19.0.0' },
        { name: '@types/react-dom', version: '19.0.0' },
        { name: 'react', version: '19.0.0' },
        { name: 'react-dom', version: '19.0.0' },
        { name: 'tsx', version: '4.0.0' },
        { name: 'typescript', version: '6.0.0' },
        { name: 'vite', version: '7.0.0' },
      ],
    )

    expect(manifest.dependencies).toMatchObject({
      '@openwaggle/extension-sdk': 'file:/tmp/extension-sdk.tgz',
      react: '19.0.0',
    })
    expect(manifest.devDependencies).toMatchObject({
      '@types/node': '24.0.0',
      tsx: '4.0.0',
      typescript: '6.0.0',
      vite: '7.0.0',
    })
  })

  it('uses portable install arguments for each package manager', () => {
    expect(packageManagerInstallArgs('npm')).toEqual(['--ignore-scripts'])
    expect(packageManagerInstallArgs('pnpm')).toEqual(['--ignore-scripts'])
    expect(packageManagerInstallArgs('yarn')).toEqual(['--mode=skip-build', '--no-immutable'])
    expect(packageManagerInstallArgs('bun')).toEqual(['--ignore-scripts'])
  })

  it('rejects a browser smoke bundle that was completely tree-shaken', () => {
    expect(() => assertBrowserBundleContent('')).toThrow(
      'Browser package smoke must emit executable JavaScript.',
    )
    expect(() => assertBrowserBundleContent('export const packageSmoke = true;')).not.toThrow()
  })

  it('reads the tarball path from pnpm pack JSON output', () => {
    expect(
      parsePnpmPackTarballPath(
        JSON.stringify({
          name: '@openwaggle/extension-sdk',
          version: '0.1.0',
          filename: '/tmp/openwaggle-extension-sdk-0.1.0.tgz',
        }),
      ),
    ).toBe('/tmp/openwaggle-extension-sdk-0.1.0.tgz')

    expect(() => parsePnpmPackTarballPath('{"filename":17}')).toThrowErrorMatchingInlineSnapshot(
      `[Error: pnpm pack did not report a tarball filename.]`,
    )
  })

  it('requires every exported package file to be present in the tarball', () => {
    const manifest = {
      name: '@openwaggle/extension-react',
      version: '0.1.0',
      types: './dist/index.d.ts',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
          require: './dist-cjs/index.js',
        },
        './styles.css': './styles.css',
      },
      pi: {
        extensions: ['./dist/extension.js'],
      },
    }

    expect(collectManifestPackagePaths(manifest)).toEqual([
      'dist-cjs/index.js',
      'dist/extension.js',
      'dist/index.d.ts',
      'dist/index.js',
      'styles.css',
    ])

    expect(() =>
      assertPackedPackageFiles({
        packageName: '@openwaggle/extension-react',
        manifest,
        files: [
          'CHANGELOG.md',
          'LICENSE',
          'README.md',
          'dist-cjs/index.js',
          'dist-cjs/package.json',
          'dist/extension.js',
          'dist/index.d.ts',
          'dist/index.js',
          'package.json',
          'styles.css',
        ],
      }),
    ).not.toThrow()
  })

  it('reports missing exports and source files that leaked into the tarball', () => {
    const manifest = {
      name: '@openwaggle/example',
      version: '0.1.0',
      exports: {
        '.': {
          import: './dist/index.js',
          require: './dist-cjs/index.js',
        },
      },
    }

    expect(() =>
      assertPackedPackageFiles({
        packageName: '@openwaggle/example',
        manifest,
        files: [
          'CHANGELOG.md',
          'LICENSE',
          'README.md',
          'dist-cjs/package.json',
          'dist/index.js',
          'package.json',
          'src/index.ts',
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: @openwaggle/example tarball is invalid: missing dist-cjs/index.js; missing dist/index.d.ts; contains disallowed file src/index.ts.]`,
    )
  })

  it('rejects every artifact outside the package allowlist, including source maps and fixtures', () => {
    const manifest = {
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
          require: './dist-cjs/index.js',
        },
      },
    }

    const requiredFiles = [
      'CHANGELOG.md',
      'LICENSE',
      'README.md',
      'dist-cjs/index.js',
      'dist-cjs/package.json',
      'dist/index.d.ts',
      'dist/index.js',
      'package.json',
    ]
    const disallowedFiles = [
      'dist-cjs/index.d.ts',
      'dist-cjs/package-lock.json',
      'dist-cjs/test.js',
      'dist-cjs/test-helper.spec.js',
      'dist/__tests__/hidden.js',
      'dist/component.js',
      'dist/component.component.d.ts',
      'dist/credentials.js',
      'dist/e2e.js',
      'dist/e2e.e2e.js',
      'dist/index.js.map',
      'dist/integration.js',
      'dist/integration.integration.js',
      'dist/private-key.js',
      'dist/private-key.pem',
      'dist/secrets.js',
      'dist/source.ts',
      'dist/test.js',
      'dist/test-helper.test.js',
      'dist/unit.js',
      'dist/unit.unit.js',
      'fixtures/package-smoke.ts',
      'release.json',
    ]

    for (const disallowedFile of disallowedFiles) {
      expect(() =>
        assertPackedPackageFiles({
          packageName: '@openwaggle/example',
          manifest,
          files: [...requiredFiles, disallowedFile],
        }),
      ).toThrow(`contains disallowed file ${disallowedFile}`)
    }
  })

  it('requires published metadata, dual exports, and packed workspace caret ranges', () => {
    const manifest = {
      name: '@openwaggle/extension-react',
      version: '0.0.0',
      license: 'MIT',
      engines: { node: '>=22.19.0' },
      repository: {
        type: 'git',
        url: 'https://github.com/OpenWaggle/OpenWaggle.git',
        directory: 'packages/extension-react',
      },
      publishConfig: { access: 'public' },
      dependencies: { '@openwaggle/extension-sdk': '^0.4.0' },
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
          require: './dist-cjs/index.js',
        },
        './styles.css': './styles.css',
      },
    }

    expect(() => assertPackedPackageMetadata(manifest, 'packages/extension-react')).not.toThrow()
    expect(() => assertDualModuleExports('@openwaggle/extension-react', manifest)).not.toThrow()
    expect(() =>
      assertPackedWorkspaceDependencyRanges('@openwaggle/extension-react', manifest, [
        { name: '@openwaggle/extension-sdk', version: '0.4.0' },
      ]),
    ).not.toThrow()
  })

  it('rejects missing publish metadata, incomplete dual exports, and non-caret workspace dependencies', () => {
    const manifest = {
      name: '@openwaggle/extension-react',
      version: '0.0.0',
      exports: {
        '.': {
          import: './dist/index.js',
        },
      },
      dependencies: { '@openwaggle/extension-sdk': '0.0.0' },
    }

    expect(() => assertPackedPackageMetadata(manifest, 'packages/extension-react')).toThrow(
      'must declare MIT license',
    )
    expect(() => assertDualModuleExports('@openwaggle/extension-react', manifest)).toThrow(
      'must provide types, import, and require targets',
    )
    expect(() =>
      assertPackedWorkspaceDependencyRanges('@openwaggle/extension-react', manifest, [
        { name: '@openwaggle/extension-sdk', version: '0.4.0' },
      ]),
    ).toThrow('must pack @openwaggle/extension-sdk as a caret range')
  })

  it('requires React to remain a runtime peer and accepts supported package consumer Node versions', () => {
    expect(() =>
      assertReactPeerDependencies({
        peerDependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      }),
    ).not.toThrow()
    expect(supportsPackageSmokeNodeVersion('22.19.0')).toBe(true)
    expect(supportsPackageSmokeNodeVersion('24.0.0')).toBe(true)
    expect(supportsPackageSmokeNodeVersion('22.18.9')).toBe(false)
    expect(supportsPackageSmokeNodeVersion('21.99.0')).toBe(false)
  })

  it('rejects React as a bundled runtime dependency', () => {
    expect(() =>
      assertReactPeerDependencies({
        dependencies: { react: '^19.0.0' },
        peerDependencies: { 'react-dom': '^19.0.0' },
      }),
    ).toThrow('must declare react as a peer dependency')
  })
})
