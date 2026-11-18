import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { validateExtensionManifest } from '@openwaggle/extension-sdk/validation'
import { describe, expect, it } from 'vitest'
import { EXTENSION_MANIFEST_SCHEMA_FILE } from '../published-json-schemas-extension-manifest'
import { publishedSchemaErrors, REPOSITORY_ROOT } from './published-json-schemas.test-harness'

const SCHEMA_URL = `https://openwaggle.ai/schemas/${EXTENSION_MANIFEST_SCHEMA_FILE}`
const FIXTURE_MANIFESTS = [
  'fixtures/extensions/openwaggle-github-issues-overview/openwaggle.extension.json',
  'fixtures/extensions/openwaggle-reload-qa/openwaggle.extension.json',
]

async function readManifest(relativePath: string) {
  const parsed: unknown = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8'),
  )
  return parsed
}

const minimalManifest = {
  $schema: SCHEMA_URL,
  manifestVersion: 1,
  id: 'schema-smoke',
  name: 'Schema smoke',
  version: '0.1.0',
  sdk: { openwaggle: '>=0.1.0 <0.2.0' },
  sourceFiles: ['src/index.ts'],
  builtArtifacts: ['dist/index.js'],
}

const entry = (entryPath: string) => ({
  contributions: {
    sidePanels: [
      {
        id: 'schema-smoke.panel',
        title: 'Panel',
        runtime: 'federated-module',
        execution: 'frame',
        entry: entryPath,
      },
    ],
  },
})
const icon = (value: unknown) => ({
  contributions: {
    sidePanels: [
      {
        id: 'schema-smoke.panel',
        title: 'Panel',
        runtime: 'federated-module',
        execution: 'frame',
        entry: 'dist/panel.js',
        icon: value,
      },
    ],
  },
})
const requirement = (binary: string) => ({
  runtimeRequirements: [{ id: 'gh', label: 'GitHub CLI', kind: 'binary', binary }],
})

const FIELD_SAMPLES = [
  ['an id with dots and dashes', { id: 'a1.b_c-d' }],
  ['an id with an uppercase letter', { id: 'Schema' }],
  ['an id starting with a dash', { id: '-schema' }],
  ['an over-long id', { id: 'a'.repeat(97) }],
  ['a prerelease version', { version: '1.2.3-beta.1+build.5' }],
  ['a two-part version', { version: '1.2' }],
  ['a version with a leading zero', { version: '01.2.3' }],
  ['a blank name', { name: '   ' }],
  ['a nested source path', { sourceFiles: ['src/a/b.ts'] }],
  ['a source path with backslashes', { sourceFiles: ['src\\a.ts'] }],
  ['an absolute source path', { sourceFiles: ['/src/a.ts'] }],
  ['a drive-letter source path', { sourceFiles: ['C:/src/a.ts'] }],
  ['a source path with ..', { sourceFiles: ['src/../a.ts'] }],
  ['a source path with .', { sourceFiles: ['./a.ts'] }],
  ['a source path with an empty segment', { sourceFiles: ['src//a.ts'] }],
  ['a source path with a trailing space', { sourceFiles: ['a.ts '] }],
  ['a source path with a NUL byte', { sourceFiles: ['a\u0000.ts'] }],
  ['a source path with a dotted name', { sourceFiles: ['.config/a..b.ts'] }],
  ['an over-long source path', { sourceFiles: ['a'.repeat(261)] }],
  ['an entry under __context__', entry('__context__/panel.js')],
  ['an entry named like __context__', entry('__context__x/panel.js')],
  ['a Lucide icon', icon('git-pull-request')],
  ['an icon name with uppercase', icon('Ticket')],
  ['an SVG icon', icon({ svg: 'assets/icon.SVG' })],
  ['a PNG icon', icon({ svg: 'assets/icon.png' })],
  ['a build command', { build: { command: 'bun run build' } }],
  ['a two-line build command', { build: { command: 'bun install\nbun run build' } }],
  ['a binary name', requirement('gh')],
  ['a binary path', requirement('/usr/bin/gh')],
  ['a binary with a space', requirement(' gh')],
  ['an HTTPS origin', { network: { origins: ['https://api.github.com'] } }],
  ['an origin with a port', { network: { origins: ['https://localhost:8443'] } }],
  ['an origin with a path', { network: { origins: ['https://api.github.com/v3'] } }],
  ['an origin with a trailing slash', { network: { origins: ['https://api.github.com/'] } }],
  ['an HTTP origin', { network: { origins: ['http://api.github.com'] } }],
  ['an uppercase origin', { network: { origins: ['https://API.github.com'] } }],
  ['an origin with port 443', { network: { origins: ['https://api.github.com:443'] } }],
  ['an IPv6 origin', { network: { origins: ['https://[::1]:8443'] } }],
] as const

describe('published extension manifest JSON Schema', () => {
  it.each(FIXTURE_MANIFESTS)('accepts the %s fixture, which OpenWaggle loads', async (file) => {
    const manifest = await readManifest(file)
    expect(validateExtensionManifest(manifest).success).toBe(true)
    expect(await publishedSchemaErrors(EXTENSION_MANIFEST_SCHEMA_FILE, manifest)).toEqual([])
  })

  it('accepts a $schema key, which OpenWaggle ignores', async () => {
    expect(validateExtensionManifest(minimalManifest).success).toBe(true)
    expect(await publishedSchemaErrors(EXTENSION_MANIFEST_SCHEMA_FILE, minimalManifest)).toEqual([])
  })

  it('accepts an undeclared key, which OpenWaggle drops, as OpenWaggle does', async () => {
    const manifest = {
      ...minimalManifest,
      publisher: 'someone',
      install: { source: 'prebuilt', mirror: 'x' },
    }
    expect(validateExtensionManifest(manifest).success).toBe(true)
    expect(await publishedSchemaErrors(EXTENSION_MANIFEST_SCHEMA_FILE, manifest)).toEqual([])
  })

  it.each([
    ['a missing required field', { ...minimalManifest, sdk: undefined }],
    ['another manifest version', { ...minimalManifest, manifestVersion: 2 }],
    ['an unknown install source', { ...minimalManifest, install: { source: 'download' } }],
    ['an over-long name', { ...minimalManifest, name: 'x'.repeat(121) }],
  ])('rejects %s, as OpenWaggle does', async (_case, manifest) => {
    const value = JSON.parse(JSON.stringify(manifest))
    expect(validateExtensionManifest(value).success).toBe(false)
    expect(await publishedSchemaErrors(EXTENSION_MANIFEST_SCHEMA_FILE, value)).not.toEqual([])
  })

  // The string rules are filters in OpenWaggle and patterns in the JSON Schema; each sample must
  // get the same verdict from both.
  it.each(FIELD_SAMPLES)('gives %s the verdict OpenWaggle gives', async (_case, patch) => {
    const manifest = { ...minimalManifest, ...patch }
    const openWaggleAccepts = validateExtensionManifest(manifest).success
    const schemaErrors = await publishedSchemaErrors(EXTENSION_MANIFEST_SCHEMA_FILE, manifest)
    expect(schemaErrors.length === 0).toBe(openWaggleAccepts)
  })

  // The differences the manifest reference and ADR 0066 state: origins the URL parser rewrites.
  it.each(['https://example.com:70000', 'https://example.com:08443', 'https://1.2.3'])(
    'accepts the origin %s, which OpenWaggle refuses',
    async (origin) => {
      const manifest = { ...minimalManifest, network: { origins: [origin] } }
      expect(validateExtensionManifest(manifest).success).toBe(false)
      expect(await publishedSchemaErrors(EXTENSION_MANIFEST_SCHEMA_FILE, manifest)).toEqual([])
    },
  )
})
