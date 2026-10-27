import { createLogger } from '../../../logger'

export const logger = createLogger('pi-agent-kernel')

/**
 * How Session Pi files are opened. Every Run opens the file again; Pi (patched) keeps a bounded
 * parse of each file it read, so a file that only grew parses only what was appended, and one
 * rewritten, as `pi --resume` does, is parsed whole.
 */
export const REUSE_PARSED_PI_FILE = { reuseParsedFile: true } as const
