import type { SessionId } from './brand'
import type { HiveSessionCatalogPage, SessionCatalogPage, SessionSummary } from './session'

export interface OpenWaggleSessionCatalogApi {
  listSessionsByIds(sessionIds: SessionId[]): Promise<SessionSummary[]>
  listSessionCatalogPage(
    archived: boolean,
    limit: number,
    cursor?: string,
  ): Promise<SessionCatalogPage>
  listHiveSessionCatalogPage(
    sessionId: SessionId,
    limit: number,
    cursor?: string,
  ): Promise<HiveSessionCatalogPage>
}
