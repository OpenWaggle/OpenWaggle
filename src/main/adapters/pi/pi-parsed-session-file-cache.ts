import { clearParsedSessionFileCache } from '@earendil-works/pi-coding-agent'

/**
 * Releases the parsed Pi session files Pi keeps between Runs so a reopen parses only appended
 * lines (D6). A Session Host without clients drops them with the rest of its idle memory; the next
 * Run parses its file once again.
 */
export function releaseParsedPiSessionFiles() {
  clearParsedSessionFileCache()
}
