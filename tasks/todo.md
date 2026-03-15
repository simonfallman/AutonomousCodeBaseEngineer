# ACE MCP Server — Connection Issue

## Problem
ACE MCP server was working before but now Claude Desktop cannot see it as a connector. The SSE connection establishes but drops, tools aren't recognized, and the server disconnects.

## Root Cause
Commit `38e6a20` introduced dynamic path routing that broke the nginx proxy contract:

- Nginx config: `location /mcp/ { proxy_pass http://127.0.0.1:3001/; }` strips `/mcp` prefix
- Server receives `/sse` (not `/mcp/sse`), so the dynamic logic set `messageEndpoint = "/message"`
- Client then POSTs to `https://simonfallman.xyz/message` which doesn't match the nginx `/mcp/` location block
- Tool calls never reach the server → tools not recognized, connection effectively dead

## Fix Applied
- [x] `src/index.ts`: Hardcoded `messageEndpoint = "/mcp/message"` — client always POSTs to `/mcp/message`, nginx strips to `/message`, server handles it
- [x] `src/tests/sse.test.ts`: Updated test handler and assertions to match the fixed behavior
- [x] Build passes, all 15 SSE tests pass

## Remaining
- [ ] Deploy updated container and verify Claude Desktop connects with tools visible
