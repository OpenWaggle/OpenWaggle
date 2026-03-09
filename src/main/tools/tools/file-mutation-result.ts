import { BYTES_PER_KIBIBYTE } from '@shared/constants/constants'
import type { ToolJsonResult } from '../define-tool'

const INLINE_FILE_MUTATION_RESULT_KIBIBYTES = 4
const MAX_INLINE_FILE_MUTATION_RESULT_BYTES =
  INLINE_FILE_MUTATION_RESULT_KIBIBYTES * BYTES_PER_KIBIBYTE

interface FileMutationResultParams {
  readonly path: string
  readonly beforeContent: string
  readonly afterContent: string
  readonly verb: 'written' | 'edited'
}

function getContentSizeBytes(content: string): number {
  return Buffer.byteLength(content, 'utf8')
}

export function buildFileMutationResult({
  path,
  beforeContent,
  afterContent,
  verb,
}: FileMutationResultParams): ToolJsonResult {
  const combinedContentSizeBytes =
    getContentSizeBytes(beforeContent) + getContentSizeBytes(afterContent)

  if (combinedContentSizeBytes <= MAX_INLINE_FILE_MUTATION_RESULT_BYTES) {
    return {
      kind: 'json',
      data: {
        message: `File ${verb}: ${path}`,
        beforeContent,
        afterContent,
      },
    }
  }

  return {
    kind: 'json',
    data: {
      message: `File ${verb}: ${path}`,
      path,
      beforeSizeBytes: getContentSizeBytes(beforeContent),
      afterSizeBytes: getContentSizeBytes(afterContent),
      largeContentOmitted: true,
    },
  }
}
