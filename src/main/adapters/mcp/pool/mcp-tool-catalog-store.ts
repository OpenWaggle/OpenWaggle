/**
 * Where the MCP tool catalogs are kept (D1.3): one private file per catalog key, or memory.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import { createLogger } from '../../../logger'

const logger = createLogger('mcp-tool-catalogs')

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isMissingFile(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** A catalog older than this is not served: the server starts and the catalog is refreshed. */
export const MCP_TOOL_CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000

const CatalogSchema = Schema.Struct({
  version: Schema.Literal(1),
  initialize: Schema.Unknown,
  toolsPages: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  savedAt: Schema.Number,
})
export type McpToolCatalog = Omit<typeof CatalogSchema.Type, 'version'>

export interface McpToolCatalogStore {
  readonly read: (key: string) => McpToolCatalog | undefined
  readonly write: (key: string, catalog: McpToolCatalog) => void
  readonly forget: (key: string) => void
}

/**
 * Catalogs hold server instructions (sometimes an account or tenant name), so they are private to
 * the user like the rest of `<userData>/mcp` (review R5 P3-2).
 */
const CATALOG_DIRECTORY_MODE = 0o700
const CATALOG_FILE_MODE = 0o600

/**
 * Removes catalogs too old to be served (and temporary files a crash left), which nothing reads
 * again: a removed server, an edited configuration, or a deleted project leaves one behind.
 */
export async function pruneMcpToolCatalogs(directory: string, now: number = Date.now()) {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue
    const file = path.join(directory, name)
    try {
      const { mtimeMs } = await stat(file)
      if (now - mtimeMs >= MCP_TOOL_CATALOG_MAX_AGE_MS) await rm(file, { force: true })
    } catch (error) {
      logger.warn('Could not prune an MCP tool catalog', { file: name, error: errorText(error) })
    }
  }
}

/** One file per catalog key under `directory`. */
export function fileBackedMcpToolCatalogStore(directory: () => string): McpToolCatalogStore {
  const file = (key: string) => path.join(directory(), `${key}.json`)
  // Once per Host, at its first write: by then the directory is known to be in use.
  let pruned = false
  return {
    read: (key) => {
      let text: string
      try {
        text = readFileSync(file(key), 'utf8')
      } catch (error) {
        // No catalog yet is the usual case; anything else turns lazy start off for the server.
        if (!isMissingFile(error)) {
          logger.warn('Could not read an MCP tool catalog', { key, error: errorText(error) })
        }
        return undefined
      }
      try {
        const decoded = safeDecodeUnknown(CatalogSchema, parseJsonUnknown(text))
        if (decoded.success) {
          const { version: _version, ...catalog } = decoded.data
          return catalog
        }
        logger.warn('An MCP tool catalog has an unknown shape; it is ignored', { key })
      } catch (error) {
        logger.warn('An MCP tool catalog is not valid JSON; it is ignored', {
          key,
          error: errorText(error),
        })
      }
      return undefined
    },
    write: (key, catalog) => {
      try {
        mkdirSync(directory(), { recursive: true, mode: CATALOG_DIRECTORY_MODE })
        const temporary = `${file(key)}.${process.pid}.tmp`
        writeFileSync(temporary, JSON.stringify({ version: 1, ...catalog }), {
          mode: CATALOG_FILE_MODE,
        })
        // Replaced whole, so a concurrent read sees the old or the new catalog.
        renameSync(temporary, file(key))
      } catch (error) {
        // Not cached: the server starts with its Session next time too.
        logger.warn('Could not save an MCP tool catalog', { key, error: errorText(error) })
      }
      if (!pruned) {
        pruned = true
        void pruneMcpToolCatalogs(directory())
      }
    },
    forget: (key) => {
      try {
        rmSync(file(key), { force: true })
      } catch (error) {
        // A catalog that stays is still checked against its server when the server starts.
        logger.warn('Could not forget an MCP tool catalog', { key, error: errorText(error) })
      }
    },
  }
}

/** An in-memory store, for tests and Hosts without user data. */
export function memoryMcpToolCatalogStore(): McpToolCatalogStore {
  const catalogs = new Map<string, McpToolCatalog>()
  return {
    read: (key) => catalogs.get(key),
    write: (key, catalog) => {
      catalogs.set(key, catalog)
    },
    forget: (key) => {
      catalogs.delete(key)
    },
  }
}
