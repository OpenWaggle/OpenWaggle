import { defineCollection } from 'astro:content';
import type { Loader } from 'astro/loaders';
import { z } from 'astro/zod';

const DEFAULT_DOC_ORDER = 999;
const DOCS_BASE_DIR = 'src/content/docs';
const FRONTMATTER_OPEN_MARKER = '---\n';
const FRONTMATTER_CLOSE_MARKER = '\n---\n';

interface FsPromisesModule {
  readdir(
    directory: string,
    options: { readonly withFileTypes: true },
  ): Promise<readonly { readonly name: string; isDirectory(): boolean }[]>;
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
}

interface PathModule {
  join(...paths: string[]): string;
  relative(from: string, to: string): string;
}

interface ParsedMarkdownFile {
  readonly data: Record<string, unknown>;
  readonly content: string;
}

function toPosixPath(pathValue: string) {
  return pathValue.replaceAll('\\', '/');
}

function entryIdFromPath(pathValue: string) {
  return toPosixPath(pathValue).replace(/\.(md|mdx)$/u, '');
}

function parseFrontmatterValue(rawValue: string) {
  const value = rawValue.trim();
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseMarkdownFrontmatter(source: string): ParsedMarkdownFile {
  const normalizedSource = source.replaceAll('\r\n', '\n');
  if (!normalizedSource.startsWith(FRONTMATTER_OPEN_MARKER)) {
    return { data: {}, content: normalizedSource };
  }

  const closingMarkerIndex = normalizedSource.indexOf(
    FRONTMATTER_CLOSE_MARKER,
    FRONTMATTER_OPEN_MARKER.length,
  );
  if (closingMarkerIndex < 0) {
    return { data: {}, content: normalizedSource };
  }

  const frontmatter = normalizedSource.slice(FRONTMATTER_OPEN_MARKER.length, closingMarkerIndex);
  const content = normalizedSource.slice(closingMarkerIndex + FRONTMATTER_CLOSE_MARKER.length);
  const data: Record<string, unknown> = {};

  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    data[key] = parseFrontmatterValue(line.slice(separatorIndex + 1));
  }

  return { data, content };
}

async function collectMarkdownEntries(
  fs: FsPromisesModule,
  path: PathModule,
  directory: string,
  parent = '',
): Promise<string[]> {
  const directoryEntries = await fs.readdir(directory, { withFileTypes: true });
  const entryGroups = await Promise.all(directoryEntries.map(async (directoryEntry) => {
    const relativePath = parent ? path.join(parent, directoryEntry.name) : directoryEntry.name;
    const absolutePath = path.join(directory, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      return collectMarkdownEntries(fs, path, absolutePath, relativePath);
    }

    if (/\.(md|mdx)$/u.test(directoryEntry.name)) {
      return [relativePath];
    }

    return [];
  }));

  return entryGroups.flat();
}

function docsMarkdownLoader(): Loader {
  return {
    name: 'openwaggle-docs-markdown-loader',
    load: async ({ config, generateDigest, parseData, renderMarkdown, store }) => {
      const fs = process.getBuiltinModule('node:fs/promises');
      const path = process.getBuiltinModule('node:path');
      const url = process.getBuiltinModule('node:url');

      const rootPath = url.fileURLToPath(config.root);
      const docsPath = path.join(rootPath, DOCS_BASE_DIR);
      const entries = await collectMarkdownEntries(fs, path, docsPath);

      store.clear();

      const loadedEntries = await Promise.all(entries.sort().map(async (entry) => {
        const filePath = path.join(docsPath, entry);
        const source = await fs.readFile(filePath, 'utf8');
        const parsed = parseMarkdownFrontmatter(source);
        const id = entryIdFromPath(entry);
        const normalizedFilePath = toPosixPath(path.relative(rootPath, filePath));
        const [data, rendered] = await Promise.all([
          parseData({
            id,
            data: parsed.data,
            filePath: normalizedFilePath,
          }),
          renderMarkdown(parsed.content, {
            fileURL: url.pathToFileURL(filePath),
          }),
        ]);

        return {
          id,
          data,
          body: parsed.content,
          filePath: normalizedFilePath,
          digest: generateDigest(source),
          rendered,
        };
      }));

      for (const entry of loadedEntries) {
        store.set(entry);
      }
    },
  };
}

const docs = defineCollection({
  loader: docsMarkdownLoader(),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().default(DEFAULT_DOC_ORDER),
    section: z.string(),
  }),
});

export const collections = { docs };
