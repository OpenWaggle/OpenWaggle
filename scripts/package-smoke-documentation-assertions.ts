import { Schema } from '@shared/schema'
import { objectFields, unknownField } from './support/object-fields'
const DOCS_VERSION_PART_COUNT = 2
const MINIMUM_KEYWORD_COUNT = 4

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringProperty(value: unknown, key: string) {
  return isObject(value) && typeof value[key] === 'string' ? value[key] : undefined
}

const documentationFieldsSchema = Schema.Struct({ bugs: unknownField, keywords: unknownField })
const bugsSchema = Schema.Struct({ url: unknownField })

export function assertPackedDocumentationMetadata(manifest: unknown, packageDirectory: string) {
  const packageSlug = packageDirectory.replace('packages/', '')
  const version = stringProperty(manifest, 'version')
  const docsVersion = version?.split('.').slice(0, DOCS_VERSION_PART_COUNT).join('.')
  const expectedHomepage = `https://openwaggle.ai/docs/packages/${packageSlug}/${docsVersion}/`
  if (stringProperty(manifest, 'homepage') !== expectedHomepage) {
    throw new Error(`${packageDirectory} packed manifest has incorrect documentation homepage.`)
  }

  const fields = objectFields(documentationFieldsSchema, manifest)
  if (
    objectFields(bugsSchema, fields?.bugs)?.url !==
    'https://github.com/OpenWaggle/OpenWaggle/issues'
  ) {
    throw new Error(`${packageDirectory} packed manifest must link to OpenWaggle issues.`)
  }

  const keywords = fields?.keywords
  if (!Array.isArray(keywords) || keywords.length < MINIMUM_KEYWORD_COUNT) {
    throw new Error(`${packageDirectory} packed manifest must declare package discovery keywords.`)
  }
}

export function assertPackedPackageReadme(input: {
  readonly packageName: string
  readonly readme: string
}) {
  const requiredContent = [
    `# ${input.packageName}`,
    'npm install',
    'pnpm add',
    'yarn add',
    'bun add',
    'https://openwaggle.ai/docs/packages/',
    'https://github.com/OpenWaggle/OpenWaggle/issues',
    '## License',
  ]
  const missing = requiredContent.filter((entry) => !input.readme.includes(entry))
  if (missing.length > 0) {
    throw new Error(`${input.packageName} README is incomplete: missing ${missing.join(', ')}.`)
  }
  if (input.readme.includes('<package-install')) {
    throw new Error(`${input.packageName} README contains an unexpanded install element.`)
  }
}
