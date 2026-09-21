import type { SessionId } from './brand'
import type {
  HiveSessionCatalogPage,
  SessionCatalogPage,
  SessionProjectPage,
  SessionSummary,
} from './session'

export interface OpenWaggleSessionCatalogApi {
  listSessionsByIds(sessionIds: SessionId[]): Promise<SessionSummary[]>
  listSessionCatalogPage(
    archived: boolean,
    limit: number,
    cursor?: string,
  ): Promise<SessionCatalogPage>
  listSessionProjectPage(
    limit: number,
    cursor?: string,
    search?: string,
  ): Promise<SessionProjectPage>
  listHiveSessionCatalogPage(
    sessionId: SessionId,
    limit: number,
    cursor?: string,
  ): Promise<HiveSessionCatalogPage>
}
