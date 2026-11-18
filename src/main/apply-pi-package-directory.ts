import { fileURLToPath } from 'node:url'
import { findPiCodingAgentPackageDirectory } from './adapters/pi/pi-package-directory'
import { applyPiPackageDirectory } from './env'

/**
 * Points Pi at its installed package before any Pi module evaluates: Pi reads `VERSION` from its
 * package.json at module load. Imported for its side effect near the top of index.ts.
 */
applyPiPackageDirectory(findPiCodingAgentPackageDirectory(fileURLToPath(import.meta.url)))
