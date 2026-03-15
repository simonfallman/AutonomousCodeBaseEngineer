# Lessons Learned

## Nginx Reverse Proxy + SSE Message Endpoints

**Problem:** Dynamic path detection for the SSE message endpoint broke when behind an nginx reverse proxy. The server checked if the client connected via `/mcp/sse` vs `/sse` to decide the message path — but nginx strips the `/mcp` prefix before forwarding, so the server always saw `/sse` and told clients to POST to `/message`, which missed the nginx `location /mcp/` block entirely.

**Fix:** Hardcode `/mcp/message` as the message endpoint. The client always uses the `/mcp/` prefix, and nginx routes it correctly.

**Rule:** When a service sits behind a reverse proxy that rewrites paths, don't infer response URLs from the incoming request path — the proxy has already rewritten it. Hardcode the client-facing path instead.
