import type { SessionId } from '@shared/types/brand'
import { createContext, use } from 'react'

/** The Session whose transcript a tool row sits in, so nested rows can read its Hive too. */
export const ToolRowSessionContext = createContext<SessionId | null>(null)

export function useToolRowSessionId() {
  return use(ToolRowSessionContext)
}
