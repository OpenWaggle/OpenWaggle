/**
 * Reads one origin's `localStorage` out of Chromium's LevelDB (`Local Storage/leveldb` under the
 * Electron session data directory). Keys are `_<storage key>\0<encoded key>`; Chromium encodes each
 * key and value as Latin-1 (prefix 1) when every code unit fits a byte, else as UTF-16LE (prefix 0).
 * `META:` and `METAACCESS:` rows and other origins (dev servers, MCP App and extension frames) are
 * left out.
 */
import { readLevelDb } from './leveldb'

const DATA_PREFIX = '_'
const ORIGIN_SEPARATOR = 0
const UTF16_ENCODING = 0
const LATIN1_ENCODING = 1
const UTF16_CODE_UNIT_BYTES = 2

export class LocalStorageDecodeError extends Error {}

function decodeStorageString(encoded: Buffer) {
  const encoding = encoded[0]
  const body = encoded.subarray(1)
  if (encoding === LATIN1_ENCODING) return body.toString('latin1')
  if (encoding === UTF16_ENCODING && body.length % UTF16_CODE_UNIT_BYTES === 0) {
    return body.toString('utf16le')
  }
  throw new LocalStorageDecodeError('A localStorage string has an unknown encoding.')
}

interface ElectronLocalStorageSnapshot {
  readonly origin: string
  readonly entries: Readonly<Record<string, string>>
  /** Rows of this origin whose encoding could not be read; never silently dropped. */
  readonly undecodable: number
}

/** `origin` is the renderer's storage key, `openwaggle://app` for the packaged app. */
export async function readElectronLocalStorage(input: {
  readonly levelDbDirectory: string
  readonly origin: string
}) {
  const prefix = Buffer.concat([
    Buffer.from(`${DATA_PREFIX}${input.origin}`, 'latin1'),
    Uint8Array.of(ORIGIN_SEPARATOR),
  ])
  // A Map, then Object.fromEntries, so a key such as `__proto__` stays an ordinary entry.
  const entries = new Map<string, string>()
  let undecodable = 0
  for (const row of await readLevelDb(input.levelDbDirectory)) {
    if (row.key.length <= prefix.length || !row.key.subarray(0, prefix.length).equals(prefix)) {
      continue
    }
    try {
      entries.set(
        decodeStorageString(row.key.subarray(prefix.length)),
        decodeStorageString(row.value),
      )
    } catch (error) {
      if (!(error instanceof LocalStorageDecodeError)) throw error
      undecodable += 1
    }
  }
  const snapshot: ElectronLocalStorageSnapshot = {
    origin: input.origin,
    entries: Object.fromEntries(entries),
    undecodable,
  }
  return snapshot
}
