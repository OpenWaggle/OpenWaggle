import { openWaggleExtensionManifestSchema } from '@openwaggle/extension-sdk/internal/manifest-schemas'
import {
  type JsonSchemaNode,
  type JsonSchemaOverlay,
  jsonSchemaFromEffect,
  publishedSchemaRoot,
} from './published-json-schemas-effect'

export const EXTENSION_MANIFEST_SCHEMA_FILE = 'openwaggle-extension-manifest-v1.schema.json'

const PATHS = 'Paths relative to the package folder, with forward slashes.'

/**
 * Field descriptions, from the manifest reference page. The schema checks shape, lengths, enums
 * and the string patterns in `internal/manifest-json-schema.ts`; rules that span fields, such as `trusted.renderer` for a `trusted-renderer` contribution
 * or a declared capability for each contribution's methods, are checked when OpenWaggle loads
 * the package and by `validateExtensionManifest`.
 */
const MANIFEST_OVERLAY: JsonSchemaOverlay = {
  '/properties/manifestVersion': { description: 'Manifest format version. Always 1.' },
  '/properties/id': {
    description:
      'Package id, the same as the package folder name: lowercase letters, digits, ".", "_" and "-", starting with a letter or digit.',
  },
  '/properties/name': { description: 'Display name.' },
  '/properties/version': {
    description: 'Package version, a semver string raised with each update.',
  },
  '/properties/description': { description: 'Short description.' },
  '/properties/sdk/properties/openwaggle': {
    description:
      'The extension API versions of the OpenWaggle host the package works with, a semver range such as ">=0.1.0 <0.2.0". The host API version and the @openwaggle/extension-sdk npm version are separate contracts: an SDK 0.3 package still names the host range.',
  },
  '/properties/sourceFiles': { description: `Every source file in the package. ${PATHS}` },
  '/properties/builtArtifacts': {
    description: `Every built file OpenWaggle loads, local build outputs included. ${PATHS}`,
  },
  '/properties/install/properties/source': {
    description:
      'prebuilt: the package ships its built files (the default). local-build: OpenWaggle runs build.command on the user’s machine.',
  },
  '/properties/build/properties/command': {
    description: 'The command that builds the package, run in the package folder.',
  },
  '/properties/build/properties/outputs': {
    description: `The files the build writes. Defaults to builtArtifacts. ${PATHS}`,
  },
  '/properties/docs/properties/topics': { description: 'Docs pages the package ships.' },
  '/properties/network/properties/origins': {
    description:
      'External origins the package may reach, each an exact HTTPS origin with no path, such as https://api.github.com.',
  },
  '/properties/capabilities': {
    description: 'The SDK capabilities the package calls, with their methods and scopes.',
  },
  '/properties/contributions': {
    description: 'Contributions by family: where the package shows up in OpenWaggle.',
  },
  '/properties/pi/properties/resourceRoots': {
    description: `Folders of Pi resources (skills, extensions, prompts, themes) the package adds. ${PATHS}`,
  },
  '/properties/trusted/properties/main': {
    description: 'Trusted local code that runs in the main process.',
  },
  '/properties/trusted/properties/renderer': {
    description:
      'Privileged renderer code. Every contribution with runtime "trusted-renderer" needs it.',
  },
  '/properties/runtimeRequirements': {
    description:
      'Programs the package needs. OpenWaggle checks for each one and never installs a missing program.',
  },
}

/**
 * OpenWaggle drops a manifest's undeclared keys instead of refusing them, so the published schema
 * allows them too. Effect writes `additionalProperties: false` on every struct; a record's
 * `additionalProperties` is a schema and stays.
 */
function isJsonSchemaNode(value: unknown): value is JsonSchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function allowingUndeclaredKeys(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(allowingUndeclaredKeys)
  if (!isJsonSchemaNode(node)) return node
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key, value]) => !(key === 'additionalProperties' && value === false))
      .map(([key, value]) => [key, allowingUndeclaredKeys(value)]),
  )
}

/** Lets a manifest name its schema: OpenWaggle ignores a manifest's undeclared keys. */
function withSchemaKeyProperty(schema: unknown) {
  if (!isJsonSchemaNode(schema)) throw new Error('Expected an object schema.')
  const { properties, ...rest } = schema
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error('Expected an object schema with properties.')
  }
  return {
    ...rest,
    properties: {
      $schema: { type: 'string', description: 'The JSON Schema for this file.' },
      ...properties,
    },
  } satisfies JsonSchemaNode
}

/** `openwaggle.extension.json`, from the schema OpenWaggle decodes a package manifest with. */
export function extensionManifestJsonSchema() {
  return publishedSchemaRoot(
    {
      fileName: EXTENSION_MANIFEST_SCHEMA_FILE,
      title: 'OpenWaggle openwaggle.extension.json',
      description:
        'The manifest of an OpenWaggle extension package: what it is, the files it ships, the capabilities it calls and where it shows up.',
    },
    withSchemaKeyProperty(
      allowingUndeclaredKeys(
        jsonSchemaFromEffect(openWaggleExtensionManifestSchema, MANIFEST_OVERLAY),
      ),
    ),
  )
}
