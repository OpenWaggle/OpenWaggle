/**
 * The rule that announces the on-demand browser preview tools. It replaces the two-paragraph
 * system prompt appendix every request used to carry; the usage guidance now arrives with
 * `preview_status` when tool search loads it.
 */
export const BROWSER_PREVIEW_AUTOMATION_RULE =
  "This Session's collaborative browser preview (preview_* tools, start with preview_status) loads with tool_search or runs from codemode; use it for browser work the user should see."
