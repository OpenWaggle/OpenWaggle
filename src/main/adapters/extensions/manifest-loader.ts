import { readFile } from 'node:fs/promises'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { parseJsonUnknown, safeDecodeUnknown } from '@shared/schema'
import { openWaggleExtensionManifestSchema } from '@shared/schemas/extensions'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../../extensions/types'

export interface LoadedManifestResult {
  readonly manifest: DiscoveredExtensionPackage['manifest']
  readonly rawManifest: string | null
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

export async function loadExtensionManifest(manifestPath: string): Promise<LoadedManifestResult> {
  let rawManifest: string
  try {
    rawManifest = await readFile(manifestPath, 'utf-8')
  } catch (error) {
    if (isEnoent(error)) {
      return {
        manifest: null,
        rawManifest: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'manifest-missing',
            message: `Missing ${OPENWAGGLE_EXTENSION.MANIFEST_FILE}.`,
            path: manifestPath,
          },
        ],
      }
    }
    return {
      manifest: null,
      rawManifest: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'filesystem-error',
          message: `Failed to read manifest: ${formatErrorMessage(error)}`,
          path: manifestPath,
        },
      ],
    }
  }

  let parsedManifest: unknown
  try {
    parsedManifest = parseJsonUnknown(rawManifest)
  } catch (error) {
    return {
      manifest: null,
      rawManifest,
      diagnostics: [
        {
          severity: 'error',
          code: 'manifest-json-invalid',
          message: `Invalid manifest JSON: ${formatErrorMessage(error)}`,
          path: manifestPath,
        },
      ],
    }
  }

  const decoded = safeDecodeUnknown(openWaggleExtensionManifestSchema, parsedManifest)
  if (!decoded.success) {
    return {
      manifest: null,
      rawManifest,
      diagnostics: decoded.issues.map((issue) => ({
        severity: 'error',
        code: 'manifest-schema-invalid',
        message: issue,
        path: manifestPath,
      })),
    }
  }

  return {
    manifest: decoded.data,
    rawManifest,
    diagnostics: [],
  }
}
