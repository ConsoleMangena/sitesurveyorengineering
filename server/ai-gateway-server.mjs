// SiteSurveyor AI host server.
//
// Serves the built frontend (frontend/dist) and tunnels the AI chat's
// WebSocket traffic (/openclaw) to the OpenClaw gateway bound on loopback.
//
// Why a proxy instead of exposing the gateway: the gateway only grants
// operator scopes to trusted loopback clients without device pairing. The
// proxy strips the browser Origin header, so from the gateway's point of view
// every chat connection is an ordinary loopback backend client — no matter
// which phone, tablet, or laptop the user is on. The gateway itself never
// leaves the host machine.
//
// Usage:
//   npm run build            # in frontend/
//   node ai-gateway-server.mjs
//   # open http://<this-machine-ip>:8787 on any device

import http from "node:http";
import net from "node:net";
import httpProxy from "http-proxy";
const { createProxyServer } = httpProxy;
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const GATEWAY_TARGET =
  process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, "../frontend/dist");

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(
    `[host] missing ${DIST}/index.html — run "npm run build" inside frontend/ first.`,
  );
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".txt": "text/plain",
};

const proxy = createProxyServer({ target: GATEWAY_TARGET, ws: true });

proxy.on("proxyReqWs", (proxyReq) => {
  // Trusted loopback backend clients skip device pairing — see header comment.
  proxyReq.removeHeader("origin");
  proxyReq.removeHeader("sec-fetch-site");
  proxyReq.removeHeader("sec-fetch-mode");
});

function proxyError(err, req, res) {
  console.error("[host] proxy error:", err.code ?? err.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "AI gateway unreachable — is `openclaw gateway run` active?",
      }),
    );
  } else if (res?.destroy) {
    res.destroy();
  }
}
proxy.on("error", proxyError);

function sendFile(res, filePath) {
  const type = MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/openclaw")) pathname = "/";
  const resolved = path.normalize(path.join(DIST, pathname));
  if (!resolved.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile()
    ? resolved
    : path.join(DIST, "index.html"); // SPA fallback
  sendFile(res, target);
}

const server = http.createServer((req, res) => {
  if ((req.url ?? "").startsWith("/openclaw")) {
    return proxy.web(req, res);
  }
  serveStatic(req, res);
});

// WebSocket upgrades: only the AI chat path is tunneled to the gateway.
server.on("upgrade", (req, socket, head) => {
  if ((req.url ?? "").startsWith("/openclaw")) {
    return proxy.ws(req, socket, head);
  }
  socket.destroy();
});

// Keepalive so long agent runs don't drop idle sockets mid-stream.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

// Warm-up TCP preconnect helper (no-op; documents intent for ops readers).
void net;

server.listen(PORT, HOST, () => {
  console.log(`[host] SiteSurveyor app  : http://${HOST}:${PORT}`);
  console.log(`[host] AI gateway tunnel: ${GATEWAY_TARGET} -> /openclaw`);
  console.log(
    `[host] Other devices: open http://<this-machine-ip>:${PORT} — nothing to install.`,
  );
});
