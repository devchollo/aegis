import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.AEGIS_SYNC_DATA_DIR || path.resolve(process.cwd(), "sync-server-data");
const DB_PATH = path.join(DATA_DIR, "aegis-sync.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const KEEPALIVE_ENABLED = process.env.AEGIS_KEEPALIVE_ENABLED === "true";
const KEEPALIVE_INTERVAL_MS = Number(process.env.AEGIS_KEEPALIVE_INTERVAL_MS || 14 * 60 * 1000);
const KEEPALIVE_URL =
  process.env.AEGIS_KEEPALIVE_URL ||
  (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "")}/health` : "");

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function noContent(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS"
  });
  response.end();
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify({ users: [] }, null, 2), "utf8");
  }
}

async function readDb() {
  await ensureDataFile();
  const raw = await fs.readFile(DB_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.users) ? parsed : { users: [] };
}

async function writeDb(db) {
  await ensureDataFile();
  const tempPath = `${DB_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tempPath, DB_PATH);
}

function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

function validateUsername(value) {
  return /^[a-z0-9._-]{3,48}$/i.test(value);
}

function hashPassword(password, saltHex) {
  return scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function verifyPassword(password, user) {
  const expected = Buffer.from(user.passwordHashHex, "hex");
  const actual = Buffer.from(hashPassword(password, user.passwordSaltHex), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSessionToken() {
  return randomBytes(32).toString("hex");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

function isVaultStateLike(value) {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.meta === undefined || isRecord(value.meta)) &&
    Array.isArray(value.credentials) &&
    Array.isArray(value.notes) &&
    isRecord(value.settings)
  );
}

async function parseJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function getBearerToken(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

function pruneExpiredSessions(user) {
  const now = Date.now();
  user.sessions = user.sessions.filter((session) => session.expiresAt > now);
}

async function authenticateRequest(request) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const db = await readDb();
  const tokenHashHex = hashToken(token);

  for (const user of db.users) {
    pruneExpiredSessions(user);
    if (user.sessions.some((session) => session.tokenHashHex === tokenHashHex)) {
      await writeDb(db);
      return { db, user };
    }
  }

  await writeDb(db);
  return null;
}

const server = http.createServer(async (request, response) => {
  if (!request.url || !request.method) {
    json(response, 400, { error: "Invalid request." });
    return;
  }

  if (request.method === "OPTIONS") {
    noContent(response);
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, service: "aegis-sync" });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/api/auth/register" || url.pathname === "/api/auth/login")) {
      const body = await parseJsonBody(request);
      const username = normalizeUsername(String(body.username || ""));
      const password = String(body.password || "");

      if (!validateUsername(username)) {
        json(response, 400, { error: "Username must be 3-48 characters and use letters, numbers, dot, underscore, or dash." });
        return;
      }

      if (password.length < 10) {
        json(response, 400, { error: "Password must be at least 10 characters." });
        return;
      }

      const db = await readDb();
      let user = db.users.find((entry) => entry.username === username);

      if (url.pathname.endsWith("/register")) {
        if (user) {
          json(response, 409, { error: "An account with that username already exists." });
          return;
        }

        user = {
          id: randomBytes(16).toString("hex"),
          username,
          passwordSaltHex: randomBytes(16).toString("hex"),
          passwordHashHex: "",
          createdAt: Date.now(),
          sessions: [],
          vault: null
        };
        user.passwordHashHex = hashPassword(password, user.passwordSaltHex);
        db.users.push(user);
      } else {
        if (!user || !verifyPassword(password, user)) {
          json(response, 401, { error: "Username or password is incorrect." });
          return;
        }
      }

      pruneExpiredSessions(user);
      const token = createSessionToken();
      user.sessions.push({
        tokenHashHex: hashToken(token),
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS
      });
      await writeDb(db);

      json(response, 200, { token });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/vault") {
      const auth = await authenticateRequest(request);
      if (!auth) {
        json(response, 401, { error: "Authentication required." });
        return;
      }

      json(response, 200, { vault: auth.user.vault ?? null });
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/vault") {
      const auth = await authenticateRequest(request);
      if (!auth) {
        json(response, 401, { error: "Authentication required." });
        return;
      }

      const body = await parseJsonBody(request);
      if (!isVaultStateLike(body.state)) {
        json(response, 400, { error: "Vault payload is invalid." });
        return;
      }

      auth.user.vault = {
        state: body.state,
        updatedAt: Date.now()
      };
      await writeDb(auth.db);

      json(response, 200, { updatedAt: auth.user.vault.updatedAt });
      return;
    }

    json(response, 404, { error: "Route not found." });
  } catch (error) {
    json(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected sync server error."
    });
  }
});

function startKeepalivePing() {
  if (!KEEPALIVE_ENABLED || !KEEPALIVE_URL || !Number.isFinite(KEEPALIVE_INTERVAL_MS) || KEEPALIVE_INTERVAL_MS < 60_000) {
    return;
  }

  const ping = async () => {
    try {
      await fetch(KEEPALIVE_URL, {
        method: "GET",
        headers: {
          "User-Agent": "aegis-sync-keepalive"
        }
      });
    } catch {
      // Silent by design.
    }
  };

  const timer = setInterval(() => {
    void ping();
  }, KEEPALIVE_INTERVAL_MS);

  timer.unref?.();
  void ping();
}

server.listen(PORT, () => {
  console.log(`Aegis Sync server listening on port ${PORT}`);
  startKeepalivePing();
});
