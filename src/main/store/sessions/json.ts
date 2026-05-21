import { parseJsonUnknown } from '@shared/schema'
import { sessionsLogger } from './constants'

export function parseJson(raw: string, context: string) {
  try {
    return parseJsonUnknown(raw)
  } catch (error) {
    sessionsLogger.warn('Failed to parse session JSON metadata', {
      context,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
