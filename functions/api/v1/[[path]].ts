/**
 * Cloudflare Pages Function for every `/api/v1/*` request on openwaggle.ai (ADR 0045): the
 * Usage statistics endpoint, the error-report tunnel, website page views and the daily
 * snapshot. It only adapts the Pages context; the behavior lives in `functions/_lib`, where it
 * is linted, typechecked and unit tested with the rest of the repository.
 */
import { handleStatisticsRequest, type StatisticsFunctionContext } from '../../_lib/handler'

export function onRequest(context: StatisticsFunctionContext) {
  return handleStatisticsRequest(context.request, context.env, context)
}
