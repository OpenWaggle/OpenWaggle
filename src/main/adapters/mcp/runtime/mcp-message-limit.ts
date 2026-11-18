/**
 * pi-mcp's limit for one MCP message. Every transport is bounded the same way: HTTP bodies, each
 * SSE event, stdio lines, and WebSocket frames.
 */
export const MCP_MAX_MESSAGE_BYTES = 16 * 1024 * 1024
