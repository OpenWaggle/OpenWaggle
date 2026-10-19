import type {
  ArchivedItemRefsPage,
  ArchivedItemsChange,
  ArchivedItemsChangeResult,
  ArchivedItemsPage,
  ArchivedItemsQuery,
  ArchivedItemsRefsQuery,
} from './archived-items'
import type { SessionId } from './brand'
import type { SessionCatalogPage, SessionProjectPage, SessionSummary } from './session'
import type { HiveSessionCatalogPage, HiveTreeSessionCatalogPage } from './session-hive-catalog'

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
  listHiveTreeSessionCatalogPage(
    sessionId: SessionId,
    limit: number,
    cursor?: string,
  ): Promise<HiveTreeSessionCatalogPage>
  queryArchivedItems(query: ArchivedItemsQuery): Promise<ArchivedItemsPage>
  listArchivedItemRefs(query: ArchivedItemsRefsQuery): Promise<ArchivedItemRefsPage>
  setArchivedItems(change: ArchivedItemsChange): Promise<ArchivedItemsChangeResult>
}
