import { describe, expect, it } from 'vitest'
import {
  assertPackedPackageFiles,
  collectManifestPackagePaths,
  parsePnpmPackTarballPath,
} from '../package-smoke-assertions'

describe('package smoke tarball assertions', () => {
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
      name: '@openwaggle/example',
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
        packageName: '@openwaggle/example',
        manifest,
        files: [
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
          'README.md',
          'dist-cjs/package.json',
          'dist/index.js',
          'package.json',
          'src/index.ts',
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: @openwaggle/example tarball is invalid: missing dist-cjs/index.js; missing dist/index.d.ts; contains source-only file src/index.ts.]`,
    )
  })
})
