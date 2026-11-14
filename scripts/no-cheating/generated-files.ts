/**
 * Generated files edited by hand (`generated-file`): a changed generated file whose content
 * differs from what its generator writes now. Each entry regenerates in memory, so the check writes nothing.
 * Generated files with their own `check` step are left to it: the usage statistics catalog, the
 * extension SDK's generated types, the package API snapshots and the package documentation. The TanStack route tree is rewritten by
 * every renderer build, and Bun cannot compare bun.lock with a fresh resolution offline, so
 * neither is checked here.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { Finding } from './findings'

const OXFMT_LAUNCHER = 'node_modules/oxfmt/bin/oxfmt'
const FORMATTER_OUTPUT_LIMIT_BYTES = 16_777_216

interface GeneratedFile {
  readonly files: RegExp
  readonly command: string
  /** What the generator writes to `file` now, or undefined when it writes no such file. */
  readonly expected: (root: string, file: string) => Promise<string | undefined>
}

export const GENERATED_FILES: readonly GeneratedFile[] = [
  {
    files: /^website\/public\/schemas\/[^/]+\.schema\.json$/u,
    command: 'bun run website:schemas',
    // Loaded only when such a file changed: the generators import the schemas and Shiki.
    expected: async (_root, file) => {
      const published = await import('../published-json-schemas')
      const schema = published.PUBLISHED_JSON_SCHEMAS.find(
        (candidate) => `${published.PUBLISHED_SCHEMA_DIRECTORY}/${candidate.fileName}` === file,
      )
      return schema === undefined ? undefined : published.renderPublishedJsonSchema(schema.build())
    },
  },
  {
    files: /^src\/renderer\/src\/shared\/lib\/syntax\/bundled-language-metadata\.generated\.ts$/u,
    command: 'bun run syntax-languages:generate',
    expected: async (root, file) => {
      const [{ bundledLanguagesInfo }, { renderSyntaxLanguageMetadata }] = await Promise.all([
        import('shiki'),
        import('../generate-syntax-language-metadata'),
      ])
      return execFileSync(
        process.execPath,
        [path.join(root, OXFMT_LAUNCHER), `--stdin-filepath=${file}`],
        {
          cwd: root,
          input: renderSyntaxLanguageMetadata(bundledLanguagesInfo),
          encoding: 'utf8',
          maxBuffer: FORMATTER_OUTPUT_LIMIT_BYTES,
        },
      )
    },
  },
]

/** Changed generated files that differ from a fresh run of their generator. */
export async function generatedFileFindings(
  root: string,
  changed: readonly { readonly file: string; readonly after: string | undefined }[],
) {
  const found = await Promise.all(
    changed.map(async ({ file, after }) => {
      const entry = GENERATED_FILES.find((candidate) => candidate.files.test(file))
      if (entry === undefined || after === undefined) return []
      const expected = await entry.expected(root, file)
      if (expected === undefined || expected === after) return []
      const finding: Finding = {
        file,
        id: 'generated-file',
        message: `differs from what its generator writes; run \`${entry.command}\` instead of editing it`,
      }
      return [finding]
    }),
  )
  return found.flat()
}
