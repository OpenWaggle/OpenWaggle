/**
 * The names of the surface through which agents, people, and MCP clients coordinate Sessions
 * (ADR 0053). One name and one action vocabulary for all three front doors: the Pi tool, the
 * `openwaggle hive` CLI, and the OpenWaggle MCP server's tool. The former `sessions`,
 * `openwaggle sessions`, and `openwaggle_sessions` names are not accepted anywhere.
 */
export const HIVE_TOOL_NAME = 'hive'
export const HIVE_CLI_COMMAND = 'hive'
export const HIVE_MCP_TOOL_NAME = 'openwaggle_hive'

/**
 * The text of the transcript row that marks a Hive wake: the Run the Host started on an idle
 * parent because Worker updates reached it. Search and the Session tree read it; the chat shows it
 * as a notice, never as a message the user wrote.
 */
export const HIVE_WAKE_NOTICE_TEXT = 'Worker updates arrived'
