# Aegis Sync Server

<p align="center">
  <img src="../aegis-logo.png" alt="Aegis logo" width="120" />
</p>

This backend is designed for a normal Render setup without Blueprints.

Stack:
- Express
- PostgreSQL
- `pg`
- `scrypt` password hashing from Node's built-in `crypto`

The server stores:
- sync account usernames
- salted password hashes
- hashed session tokens
- the encrypted Aegis vault blob

The server does not store:
- the Aegis master password
- decrypted passwords
- decrypted secure note bodies

## Folder Contents

- [server.mjs](./server.mjs): Express app
- [package.json](./package.json): backend dependencies
- [schema.sql](./schema.sql): PostgreSQL schema reference
- [.env.example](./.env.example): example local and Render environment values

## Local Development

From the repo root:

```bash
cd sync-server
npm install
npm run dev
```

Required environment variables:

- `DATABASE_URL`: PostgreSQL connection string

Optional:

- `PORT`: defaults to `3000`
- `PGSSL=true`: enable SSL for Postgres connections
- `AEGIS_SESSION_TTL_MS`: defaults to 30 days
- `AEGIS_KEEPALIVE_ENABLED=true`: enable silent self-ping
- `AEGIS_KEEPALIVE_INTERVAL_MS=840000`: ping interval
- `AEGIS_KEEPALIVE_URL=https://your-service.onrender.com/health`: explicit health URL

Copy the example env file if you want a local starting point:

```bash
cp .env.example .env
```

Health check:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "ok": true,
  "service": "aegis-sync"
}
```

Readiness / DB check:

```bash
curl http://localhost:3000/ready
```

Root debug page:

```text
http://localhost:3000/
```

This page confirms:
- Express is up
- PostgreSQL is reachable
- required tables exist
- current row counts for users, sessions, and vaults

## Render Deployment Without Blueprint

### 1. Push the repo

Push this repo to GitHub.

### 2. Create PostgreSQL in Render

In Render:

1. Click `New +`
2. Choose `PostgreSQL`
3. Create the database
4. Wait until it is ready

You will use its `Internal Database URL` for the backend service.

### 3. Create the web service manually

In Render:

1. Click `New +`
2. Choose `Web Service`
3. Select the same repo
4. Set `Root Directory` to:

```text
sync-server
```

5. Set `Runtime` to:

```text
Node
```

6. Set the build command to:

```text
npm install
```

7. Set the start command to:

```text
npm start
```

### 4. Add environment variables

Add these in the Render web service:

- `DATABASE_URL`
  Value: use the Render Postgres internal connection string
- `PORT`
  Value: leave unset unless you need custom behavior

Optional but useful:

- `PGSSL=false`
  Use `false` for Render internal Postgres connections unless your setup specifically requires SSL
- `AEGIS_KEEPALIVE_ENABLED=true`
- `AEGIS_KEEPALIVE_INTERVAL_MS=840000`

If you want to force the ping target manually:

- `AEGIS_KEEPALIVE_URL=https://your-service-name.onrender.com/health`

### 5. Deploy

Deploy the web service.

After deployment, open:

```text
https://your-service-name.onrender.com/health
```

You should get:

```json
{
  "ok": true,
  "service": "aegis-sync"
}
```

Then also open:

```text
https://your-service-name.onrender.com/ready
```

and:

```text
https://your-service-name.onrender.com/
```

Those are the easiest ways to confirm the database is connected and schema initialization succeeded.

## Connect It To Aegis

In the extension:

1. Open Aegis
2. On first setup, use the `Aegis Sync` sign-in section, or open the `Security` tab later
3. Enter:
   - server URL: `https://your-service-name.onrender.com`
   - username
   - account password
4. Choose:
   - `Sign in` if the account already exists
   - `Create account` if it does not
5. Enable sync

Behavior:
- if the remote account already has a vault and this device has no local vault yet, Aegis downloads the encrypted vault
- if this device already has a local vault, Aegis keeps the local vault and uploads that encrypted state when sync is enabled

## API

### `GET /health`

Health endpoint.

### `GET /ready`

Database readiness endpoint. Returns:

- database connection status
- current timestamps
- table row counts

This is useful when debugging Render environment or Postgres wiring.

### `POST /api/auth/register`

Body:

```json
{
  "username": "jane",
  "password": "strong-account-password"
}
```

Response:

```json
{
  "token": "session-token"
}
```

### `POST /api/auth/login`

Body:

```json
{
  "username": "jane",
  "password": "strong-account-password"
}
```

Response:

```json
{
  "token": "session-token"
}
```

### `GET /api/vault`

Header:

```text
Authorization: Bearer <token>
```

Response:

```json
{
  "vault": {
    "state": {},
    "updatedAt": 1773430000000
  }
}
```

or:

```json
{
  "vault": null
}
```

### `GET /api/vault/meta`

Header:

```text
Authorization: Bearer <token>
```

Response:

```json
{
  "vault": {
    "updatedAt": 1773430000000
  }
}
```

or:

```json
{
  "vault": null
}
```

The extension uses this lightweight endpoint during polling so it only downloads the full vault when the remote timestamp changed.

### `PUT /api/vault`

Header:

```text
Authorization: Bearer <token>
```

Body:

```json
{
  "state": {
    "meta": {},
    "credentials": [],
    "notes": [],
    "settings": {}
  }
}
```

Response:

```json
{
  "updatedAt": 1773430000000
}
```

## Database Notes

The server auto-creates the required tables on startup.

The reference schema is also included in [schema.sql](./schema.sql).

## Important Note About Sleeping

Yes, you can avoid Blueprints and use a normal Render web service plus PostgreSQL.

But if you deploy on a sleeping/free service:
- it may still sleep due Render plan behavior
- the silent self-ping is only a best-effort keepalive
- it is not a guaranteed substitute for an always-on paid instance

If you need reliable no-sleep behavior, use a non-free Render instance type.

## Sync Polling Behavior

The extension does not poll every second.

Current behavior:
- remote checks are throttled to once per 60 seconds
- the dashboard only runs the timer when sync is enabled, authenticated, and the page is visible
- the extension first calls `/api/vault/meta`
- it only calls `/api/vault` when the remote `updatedAt` is newer than the last synced state or the local vault is empty

That keeps the steady-state sync traffic small and avoids repeatedly downloading the full encrypted vault blob.
