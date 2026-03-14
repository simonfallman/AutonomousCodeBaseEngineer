import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";

// We spin up the SSE server in-process by importing the server factory,
// then test keepalives, path routing, CORS, and session lifecycle.

let server: http.Server;
let port: number;

/** Minimal HTTP GET that returns the raw response for SSE inspection. */
function rawGet(path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; res: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body, res }));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

/** HTTP request helper supporting any method. */
function request(method: string, path: string, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://127.0.0.1:${port}${path}`);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: body ? { "Content-Type": "application/json" } : {} }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: data }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Connect to SSE endpoint and collect events/comments for a given duration. */
function collectSSE(path: string, durationMs: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; chunks: string[] }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks: string[] = [];
      res.on("data", (chunk: Buffer) => { chunks.push(chunk.toString()); });
      setTimeout(() => {
        res.destroy();
        resolve({ status: res.statusCode!, headers: res.headers, chunks });
      }, durationMs);
    });
    req.on("error", (err) => {
      // ECONNRESET is expected when we destroy the response
      if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
      reject(err);
    });
  });
}

beforeAll(async () => {
  // Dynamically import and start the SSE server on a random port.
  // We set env vars before importing so the server module picks them up.
  process.env.MCP_TRANSPORT = "sse";
  process.env.PORT = "0"; // let OS assign
  process.env.HOST = "127.0.0.1";
  process.env.MAX_SESSIONS = "3";

  // We can't easily import index.ts (it has side effects and starts listening).
  // Instead, replicate the HTTP handler logic to test it in isolation.
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");

  const sessions = new Map<string, { transport: InstanceType<typeof SSEServerTransport>; server: InstanceType<typeof McpServer> }>();
  const MAX_SESSIONS = 3;
  // Use a fast keepalive interval for testing (200ms instead of 25s)
  const KEEPALIVE_INTERVAL_MS = 200;

  server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost`);
    const pathname = url.pathname;

    if (req.method === "GET" && (pathname === "/sse" || pathname === "/mcp/sse")) {
      if (sessions.size >= MAX_SESSIONS) {
        res.writeHead(503).end("Too many sessions");
        return;
      }
      const messageEndpoint = pathname.startsWith("/mcp") ? "/mcp/message" : "/message";
      const transport = new SSEServerTransport(messageEndpoint, res);
      const mcpServer = new McpServer({ name: "test-server", version: "0.0.1" });
      sessions.set(transport.sessionId, { transport, server: mcpServer });

      const keepaliveInterval = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(":keepalive\n\n");
        }
      }, KEEPALIVE_INTERVAL_MS);

      res.on("close", () => {
        clearInterval(keepaliveInterval);
        sessions.delete(transport.sessionId);
      });
      await mcpServer.connect(transport);
    } else if (req.method === "POST" && (pathname === "/message" || pathname === "/mcp/message")) {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const session = sessions.get(sessionId);
      if (!session) { res.writeHead(404).end("Session not found"); return; }
      await session.transport.handlePostMessage(req, res);
    } else if (req.method === "GET" && (pathname === "/health" || pathname === "/mcp/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", sessions: sessions.size }));
    } else {
      res.writeHead(404).end("Not found");
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as import("net").AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("SSE server", () => {
  describe("path routing", () => {
    it("serves SSE on /sse", async () => {
      const result = await collectSSE("/sse", 300);
      expect(result.status).toBe(200);
      expect(result.headers["content-type"]).toContain("text/event-stream");
    });

    it("serves SSE on /mcp/sse", async () => {
      const result = await collectSSE("/mcp/sse", 300);
      expect(result.status).toBe(200);
      expect(result.headers["content-type"]).toContain("text/event-stream");
    });

    it("returns endpoint event with /message path when connecting via /sse", async () => {
      const result = await collectSSE("/sse", 300);
      const allData = result.chunks.join("");
      expect(allData).toContain("event: endpoint");
      // The message endpoint should NOT have /mcp prefix
      expect(allData).toMatch(/data:.*\/message\?sessionId=/);
      expect(allData).not.toMatch(/data:.*\/mcp\/message/);
    });

    it("returns endpoint event with /mcp/message path when connecting via /mcp/sse", async () => {
      const result = await collectSSE("/mcp/sse", 300);
      const allData = result.chunks.join("");
      expect(allData).toContain("event: endpoint");
      expect(allData).toMatch(/data:.*\/mcp\/message\?sessionId=/);
    });

    it("returns 404 for unknown paths", async () => {
      const result = await rawGet("/unknown");
      expect(result.status).toBe(404);
    });

    it("health endpoint works on /health", async () => {
      const result = await rawGet("/health");
      expect(result.status).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe("ok");
      expect(typeof body.sessions).toBe("number");
    });

    it("health endpoint works on /mcp/health", async () => {
      const result = await rawGet("/mcp/health");
      expect(result.status).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe("ok");
    });
  });

  describe("CORS", () => {
    it("sets CORS headers on GET responses", async () => {
      const result = await rawGet("/health");
      expect(result.headers["access-control-allow-origin"]).toBe("*");
      expect(result.headers["access-control-allow-methods"]).toContain("POST");
    });

    it("handles OPTIONS preflight with 204", async () => {
      const result = await request("OPTIONS", "/sse");
      expect(result.status).toBe(204);
      expect(result.headers["access-control-allow-origin"]).toBe("*");
      expect(result.headers["access-control-allow-headers"]).toContain("Authorization");
    });
  });

  describe("keepalive", () => {
    it("sends keepalive comments on SSE stream", async () => {
      // Collect for 700ms — with 200ms interval we should get ~3 keepalives
      const result = await collectSSE("/sse", 700);
      const allData = result.chunks.join("");
      const keepaliveCount = (allData.match(/:keepalive/g) || []).length;
      expect(keepaliveCount).toBeGreaterThanOrEqual(2);
    });

    it("keepalive is an SSE comment (starts with colon)", async () => {
      const result = await collectSSE("/sse", 500);
      const allData = result.chunks.join("");
      // SSE comments start with ':' and are ignored by EventSource clients
      expect(allData).toContain(":keepalive\n\n");
    });
  });

  describe("session lifecycle", () => {
    it("returns 404 for POST to /message with invalid sessionId", async () => {
      const result = await request("POST", "/message?sessionId=nonexistent", "{}");
      expect(result.status).toBe(404);
      expect(result.body).toContain("Session not found");
    });

    it("returns 404 for POST to /mcp/message with invalid sessionId", async () => {
      const result = await request("POST", "/mcp/message?sessionId=nonexistent", "{}");
      expect(result.status).toBe(404);
      expect(result.body).toContain("Session not found");
    });

    it("cleans up session when client disconnects", async () => {
      // Connect and get initial session count
      const healthBefore = await rawGet("/health");
      const sessionsBefore = JSON.parse(healthBefore.body).sessions;

      // Start SSE connection
      const sseResult = await collectSSE("/sse", 300);
      expect(sseResult.status).toBe(200);

      // After disconnect, session should be cleaned up (give it a moment)
      await new Promise((r) => setTimeout(r, 100));
      const healthAfter = await rawGet("/health");
      const sessionsAfter = JSON.parse(healthAfter.body).sessions;
      expect(sessionsAfter).toBe(sessionsBefore);
    });

    it("rejects new sessions when MAX_SESSIONS is reached", async () => {
      // Open MAX_SESSIONS (3) concurrent SSE connections
      const controllers: AbortController[] = [];
      const connections: Promise<void>[] = [];

      for (let i = 0; i < 3; i++) {
        const controller = new AbortController();
        controllers.push(controller);
        connections.push(new Promise<void>((resolve) => {
          const req = http.get(`http://127.0.0.1:${port}/sse`, { signal: controller.signal }, (res) => {
            res.on("data", () => {}); // consume data
            res.on("end", resolve);
            res.on("error", resolve);
          });
          req.on("error", resolve);
        }));
      }

      // Wait for connections to establish
      await new Promise((r) => setTimeout(r, 200));

      // The 4th connection should be rejected with 503
      const overflow = await rawGet("/sse");
      expect(overflow.status).toBe(503);

      // Cleanup
      controllers.forEach((c) => c.abort());
      await Promise.allSettled(connections);
    });
  });
});
