const SEARCHABLE_CUSTOM_MESSAGE_TYPES_SQL =
  "'openwaggle-delegation-specification-update', 'openwaggle-orchestration-update', 'openwaggle-peer-agent-report'"

/** SQLite equivalent of the node-aware transcript document projection. */
export function sessionTranscriptSearchContentSql(source: string) {
  return `substr(CASE
    WHEN ${source}.role IN ('user', 'assistant') OR ${source}.kind = 'tool_result' THEN COALESCE(
      (SELECT GROUP_CONCAT(
        CASE json_extract(part.value, '$.type')
          WHEN 'text' THEN json_extract(part.value, '$.text')
          WHEN 'attachment' THEN json_extract(part.value, '$.attachment.name')
          WHEN 'tool-call' THEN json_extract(part.value, '$.toolCall.name')
          WHEN 'tool-result' THEN trim(
            COALESCE(json_extract(part.value, '$.toolResult.name'), '') || ' ' ||
            CASE json_extract(part.value, '$.toolResult.isError')
              WHEN 1 THEN 'failed' ELSE 'completed'
            END
          )
          ELSE NULL
        END,
        ' '
      ) FROM json_each(${source}.content_json, '$.parts') AS part),
      json_extract(${source}.content_json, '$.text'),
      ''
    )
    WHEN ${source}.kind IN ('branch_summary', 'compaction_summary')
      THEN COALESCE(json_extract(${source}.content_json, '$.summary'), '')
    WHEN ${source}.kind = 'custom'
      AND json_extract(${source}.content_json, '$.display') = 1
      AND json_extract(${source}.content_json, '$.customType') IN (
        ${SEARCHABLE_CUSTOM_MESSAGE_TYPES_SQL}
      )
      THEN COALESCE(json_extract(${source}.content_json, '$.content'), '')
    ELSE ''
  END, 1, 12000)`
}
