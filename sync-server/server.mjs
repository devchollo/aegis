import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import cors from "cors";
import express from "express";
import pg from "pg";

const { Pool } = pg;

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_TTL_MS = Number(process.env.AEGIS_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 30);
const KEEPALIVE_ENABLED = process.env.AEGIS_KEEPALIVE_ENABLED === "true";
const KEEPALIVE_INTERVAL_MS = Number(process.env.AEGIS_KEEPALIVE_INTERVAL_MS || 14 * 60 * 1000);
const KEEPALIVE_URL =
  process.env.AEGIS_KEEPALIVE_URL ||
  (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "")}/health` : "");

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the Aegis sync server.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
});

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

async function getReadinessReport() {
  const [dbNow, users, sessions, vaults] = await Promise.all([
    pool.query(`select now() as now`),
    pool.query(`select count(*)::int as count from users`),
    pool.query(`select count(*)::int as count from sessions`),
    pool.query(`select count(*)::int as count from vaults`)
  ]);

  return {
    ok: true,
    service: "aegis-sync",
    database: "connected",
    checkedAt: Date.now(),
    dbNow: new Date(dbNow.rows[0].now).getTime(),
    counts: {
      users: users.rows[0].count,
      sessions: sessions.rows[0].count,
      vaults: vaults.rows[0].count
    }
  };
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
  const expected = Buffer.from(user.password_hash_hex, "hex");
  const actual = Buffer.from(hashPassword(password, user.password_salt_hex), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSessionToken() {
  return randomBytes(32).toString("hex");
}

function createId() {
  return randomBytes(16).toString("hex");
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

async function initializeDatabase() {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      username text not null unique,
      password_salt_hex text not null,
      password_hash_hex text not null,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists sessions (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      token_hash_hex text not null unique,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    );
  `);

  await pool.query(`
    create table if not exists vaults (
      user_id text primary key references users(id) on delete cascade,
      encrypted_state_json jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists sessions_token_hash_idx on sessions(token_hash_hex);
  `);
}

async function pruneExpiredSessions() {
  await pool.query(`delete from sessions where expires_at <= now()`);
}

async function authenticateRequest(request, response, next) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  await pruneExpiredSessions();

  const tokenHashHex = hashToken(authorization.slice("Bearer ".length).trim());
  const result = await pool.query(
    `
      select users.id, users.username
      from sessions
      inner join users on users.id = sessions.user_id
      where sessions.token_hash_hex = $1
        and sessions.expires_at > now()
      limit 1
    `,
    [tokenHashHex]
  );

  if (!result.rows[0]) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  request.user = result.rows[0];
  next();
}

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "aegis-sync" });
});

app.get("/", async (_request, response) => {
  try {
    const report = await getReadinessReport();
    response
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Aegis Sync</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }
      .card { max-width: 760px; margin: 0 auto; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 20px; padding: 24px; box-shadow: 0 20px 50px rgba(2, 6, 23, 0.35); }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { color: #cbd5e1; line-height: 1.5; }
      .row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
      .pill { border-radius: 999px; padding: 8px 12px; background: rgba(20, 184, 166, 0.14); color: #99f6e4; border: 1px solid rgba(45, 212, 191, 0.18); }
      .stats { margin-top: 20px; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
      .stat { border-radius: 16px; background: rgba(30, 41, 59, 0.72); padding: 16px; border: 1px solid rgba(148, 163, 184, 0.14); }
      .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; }
      .value { margin-top: 6px; font-size: 22px; font-weight: 700; color: #f8fafc; }
      a { color: #5eead4; }
      code { color: #f8fafc; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Aegis Sync</h1>
      <p>The sync backend is running and connected to PostgreSQL.</p>
      <div class="row">
        <div class="pill">Service: ${report.service}</div>
        <div class="pill">Database: ${report.database}</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="label">Users</div><div class="value">${report.counts.users}</div></div>
        <div class="stat"><div class="label">Sessions</div><div class="value">${report.counts.sessions}</div></div>
        <div class="stat"><div class="label">Vaults</div><div class="value">${report.counts.vaults}</div></div>
      </div>
      <p style="margin-top:20px;">JSON checks: <a href="/health"><code>/health</code></a> and <a href="/ready"><code>/ready</code></a>.</p>
    </div>
  </body>
</html>`);
  } catch (error) {
    response.status(500).type("html").send(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Aegis Sync Error</title></head>
  <body style="font-family:system-ui,sans-serif;padding:24px;background:#111827;color:#f9fafb;">
    <h1>Aegis Sync startup check failed</h1>
    <p>${error instanceof Error ? error.message : "Unexpected sync server error."}</p>
    <p>Check <code>DATABASE_URL</code>, PostgreSQL availability, and permissions.</p>
  </body>
</html>`);
  }
});

app.get("/ready", async (_request, response) => {
  try {
    const report = await getReadinessReport();
    response.json(report);
  } catch (error) {
    response.status(500).json({
      ok: false,
      service: "aegis-sync",
      database: "unavailable",
      error: error instanceof Error ? error.message : "Readiness check failed."
    });
  }
});

app.post("/api/auth/register", async (request, response, next) => {
  try {
    const username = normalizeUsername(String(request.body?.username || ""));
    const password = String(request.body?.password || "");

    if (!validateUsername(username)) {
      response.status(400).json({
        error: "Username must be 3-48 characters and use letters, numbers, dot, underscore, or dash."
      });
      return;
    }

    if (password.length < 10) {
      response.status(400).json({ error: "Password must be at least 10 characters." });
      return;
    }

    const existing = await pool.query(`select id from users where username = $1 limit 1`, [username]);
    if (existing.rows[0]) {
      response.status(409).json({ error: "An account with that username already exists." });
      return;
    }

    const userId = createId();
    const passwordSaltHex = randomBytes(16).toString("hex");
    const passwordHashHex = hashPassword(password, passwordSaltHex);

    await pool.query(
      `
        insert into users (id, username, password_salt_hex, password_hash_hex)
        values ($1, $2, $3, $4)
      `,
      [userId, username, passwordSaltHex, passwordHashHex]
    );

    const token = createSessionToken();
    await pool.query(
      `
        insert into sessions (id, user_id, token_hash_hex, expires_at)
        values ($1, $2, $3, to_timestamp($4 / 1000.0))
      `,
      [createId(), userId, hashToken(token), Date.now() + SESSION_TTL_MS]
    );

    response.json({ token });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const username = normalizeUsername(String(request.body?.username || ""));
    const password = String(request.body?.password || "");

    if (!validateUsername(username) || password.length < 10) {
      response.status(401).json({ error: "Username or password is incorrect." });
      return;
    }

    const result = await pool.query(
      `
        select id, username, password_salt_hex, password_hash_hex
        from users
        where username = $1
        limit 1
      `,
      [username]
    );

    const user = result.rows[0];
    if (!user || !verifyPassword(password, user)) {
      response.status(401).json({ error: "Username or password is incorrect." });
      return;
    }

    const token = createSessionToken();
    await pool.query(
      `
        insert into sessions (id, user_id, token_hash_hex, expires_at)
        values ($1, $2, $3, to_timestamp($4 / 1000.0))
      `,
      [createId(), user.id, hashToken(token), Date.now() + SESSION_TTL_MS]
    );

    response.json({ token });
  } catch (error) {
    next(error);
  }
});

app.get("/api/vault", authenticateRequest, async (request, response, next) => {
  try {
    const result = await pool.query(
      `
        select encrypted_state_json as state, extract(epoch from updated_at) * 1000 as updated_at
        from vaults
        where user_id = $1
        limit 1
      `,
      [request.user.id]
    );

    const row = result.rows[0];
    response.json({
      vault: row
        ? {
            state: row.state,
            updatedAt: Math.round(Number(row.updated_at))
          }
        : null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/vault/meta", authenticateRequest, async (request, response, next) => {
  try {
    const result = await pool.query(
      `
        select extract(epoch from updated_at) * 1000 as updated_at
        from vaults
        where user_id = $1
        limit 1
      `,
      [request.user.id]
    );

    const row = result.rows[0];
    response.json({
      vault: row
        ? {
            updatedAt: Math.round(Number(row.updated_at))
          }
        : null
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/vault", authenticateRequest, async (request, response, next) => {
  try {
    if (!isVaultStateLike(request.body?.state)) {
      response.status(400).json({ error: "Vault payload is invalid." });
      return;
    }

    const result = await pool.query(
      `
        insert into vaults (user_id, encrypted_state_json, updated_at)
        values ($1, $2::jsonb, now())
        on conflict (user_id)
        do update set
          encrypted_state_json = excluded.encrypted_state_json,
          updated_at = now()
        returning extract(epoch from updated_at) * 1000 as updated_at
      `,
      [request.user.id, JSON.stringify(request.body.state)]
    );

    response.json({ updatedAt: Math.round(Number(result.rows[0].updated_at)) });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error("Aegis sync server error", error);
  response.status(500).json({
    error: error instanceof Error ? error.message : "Unexpected sync server error."
  });
});

function startKeepalivePing() {
  if (
    !KEEPALIVE_ENABLED ||
    !KEEPALIVE_URL ||
    !Number.isFinite(KEEPALIVE_INTERVAL_MS) ||
    KEEPALIVE_INTERVAL_MS < 60_000
  ) {
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

await initializeDatabase();

app.listen(PORT, () => {
  console.log(`Aegis Sync server listening on port ${PORT}`);
  startKeepalivePing();
});
