import { defineCollection } from 'astro:content'
import type { Loader } from 'astro/loaders'
import { docsFrontmatterSchema, parseMarkdownFrontmatter } from './lib/docs-frontmatter'

const DOCS_BASE_DIR = 'src/content/docs'

interface FsPromisesModule {
  readdir(
    directory: string,
    options: { readonly withFileTypes: true },
  ): Promise<readonly { readonly name: string; isDirectory(): boolean }[]>
  readFile(filePath: string, encoding: 'utf8'): Promise<string>
}

interface PathModule {
  join(...paths: string[]): string
  relative(from: string, to: string): string
}

function toPosixPath(pathValue: string) {
  return pathValue.replaceAll('\\', '/')
}

function entryIdFromPath(pathValue: string) {
  return toPosixPath(pathValue).replace(/\.(md|mdx)$/u, '')
}

async function collectMarkdownEntries(
  fs: FsPromisesModule,
  path: PathModule,
  directory: string,
  parent = '',
): Promise<string[]> {
  const directoryEntries = await fs.readdir(directory, { withFileTypes: true })
  const entryGroups = await Promise.all(
    directoryEntries.map(async (directoryEntry) => {
      const relativePath = parent ? path.join(parent, directoryEntry.name) : directoryEntry.name
      const absolutePath = path.join(directory, directoryEntry.name)

      if (directoryEntry.isDirectory()) {
        return collectMarkdownEntries(fs, path, absolutePath, relativePath)
      }

      if (/\.(md|mdx)$/u.test(directoryEntry.name)) {
        return [relativePath]
      }

      return []
    }),
  )

  return entryGroups.flat()
}

function docsMarkdownLoader(): Loader {
  return {
    name: 'openwaggle-docs-markdown-loader',
    load: async (context) => {
      const { config, store } = context
      const fs = process.getBuiltinModule('node:fs/promises')
      const path = process.getBuiltinModule('node:path')
      const url = process.getBuiltinModule('node:url')

      const rootPath = url.fileURLToPath(config.root)
      const docsPath = path.join(rootPath, DOCS_BASE_DIR)
      const entries = await collectMarkdownEntries(fs, path, docsPath)

      store.clear()

      const loadedEntries = await Promise.all(
        entries.sort().map(async (entry) => {
          const filePath = path.join(docsPath, entry)
          const source = await fs.readFile(filePath, 'utf8')
          const parsed = parseMarkdownFrontmatter(source)
          const id = entryIdFromPath(entry)
          const normalizedFilePath = toPosixPath(path.relative(rootPath, filePath))
          const [data, rendered] = await Promise.all([
            context.parseData({
              id,
              data: parsed.data,
              filePath: normalizedFilePath,
            }),
            context.renderMarkdown(parsed.content, {
              fileURL: url.pathToFileURL(filePath),
            }),
          ])

          return {
            id,
            data,
            body: parsed.content,
            filePath: normalizedFilePath,
            digest: context.generateDigest(source),
            rendered,
          }
        }),
      )

      for (const entry of loadedEntries) {
        // MDX entries compile their own imports/components through the MDX
        // integration at render time; pre-rendering them here would emit raw
        // import statements as text. Markdown entries still pre-render.
        const isMdx = (entry.filePath ?? '').endsWith('.mdx')
        store.set(isMdx ? { ...entry, rendered: undefined, deferredRender: true } : entry)
      }
    },
  }
}

const docs = defineCollection({
  loader: docsMarkdownLoader(),
  schema: docsFrontmatterSchema,
})

export const collections = { docs }
