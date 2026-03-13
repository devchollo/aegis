# Aegis Sync Server

This server lets Aegis sync across devices by storing the encrypted vault state remotely.

What the server stores:
- sync account usernames
- salted `scrypt` password hashes
- hashed session tokens
- the encrypted Aegis vault blob uploaded by the extension

What the server does not store:
- the master password
- decrypted note bodies
- decrypted saved passwords

## Important Render Note

Your current [render.yaml](../render.yaml) uses `plan: starter`.

That is the correct choice if you want the service to stay available. Render free web services sleep; `starter` is a paid instance type and does not rely on inbound traffic to stay awake the same way free instances do.

I also added an optional silent self-ping:
- `AEGIS_KEEPALIVE_ENABLED=true`
- `AEGIS_KEEPALIVE_INTERVAL_MS=840000`

This quietly pings `/health` every 14 minutes using the service URL from `RENDER_EXTERNAL_URL` when available.

Practical caveat:
- self-ping is not a substitute for a paid always-on instance
- if you deploy on a sleeping/free service, do not assume this guarantees wake prevention
- the reliable fix for sleep is using a non-free Render plan

## Files

- Server entry: [server.mjs](./server.mjs)
- Render blueprint: [render.yaml](../render.yaml)

## Local Run

From the repo root:

```bash
npm run sync:server
```

Defaults:
- port: `3000`
- data dir: `./sync-server-data`

Health check:

```bash
curl http://localhost:3000/health
```

## Environment Variables

- `PORT`: HTTP port, default `3000`
- `AEGIS_SYNC_DATA_DIR`: writable directory for the JSON datastore
- `AEGIS_KEEPALIVE_ENABLED`: set to `true` to enable the silent keepalive ping
- `AEGIS_KEEPALIVE_INTERVAL_MS`: keepalive interval in milliseconds, minimum practical value is `60000`
- `AEGIS_KEEPALIVE_URL`: optional explicit URL to ping; if omitted, the server uses `RENDER_EXTERNAL_URL + /health` when available

## Render Deployment

### 1. Push the repo

Push this repo to GitHub or another Git provider connected to Render.

### 2. Create the web service

In Render:

1. Click `New +`
2. Choose `Blueprint`
3. Select this repo
4. Render should detect [render.yaml](../render.yaml)
5. Confirm the service name and create the blueprint

This will create:
- a Node web service named `aegis-sync`

### 3. Attach a persistent disk

This step matters. Without a persistent disk, accounts and synced vaults will be lost on redeploy or instance replacement.

In Render:

1. Open the `aegis-sync` service
2. Go to `Disks`
3. Add a persistent disk
4. Mount path: `/opt/render/project/data`

That matches the `AEGIS_SYNC_DATA_DIR` value in [render.yaml](../render.yaml).

### 4. Verify environment variables

The blueprint already sets:

- `NODE_VERSION=20`
- `AEGIS_SYNC_DATA_DIR=/opt/render/project/data`
- `AEGIS_KEEPALIVE_ENABLED=true`
- `AEGIS_KEEPALIVE_INTERVAL_MS=840000`

Optional:
- add `AEGIS_KEEPALIVE_URL=https://your-service.onrender.com/health` if you want to force the ping target explicitly

### 5. Deploy

Render will run:

- build: `npm install`
- start: `node sync-server/server.mjs`

### 6. Verify the service is live

Open:

```text
https://your-service-name.onrender.com/health
```

Expected response:

```json
{
  "ok": true,
  "service": "aegis-sync"
}
```

## Connect It To Aegis

In the extension:

1. Open Aegis
2. On first setup, use the prominent `Aegis Sync` sign-in section, or open the `Security` tab later
3. Enter:
   - sync server URL: `https://your-service-name.onrender.com`
   - username
   - account password
4. Choose:
   - `Sign in` if the account already exists
   - `Create account` if it does not
5. Enable sync

Behavior:
- if the remote account already has a vault and this device has no local vault yet, Aegis downloads the encrypted vault first
- if this device already has a vault, Aegis keeps the local vault and syncs that encrypted state upward once sync is enabled

## API Summary

### `GET /health`

Basic health check.

### `POST /api/auth/register`

Body:

```json
{
  "username": "jane",
  "password": "very-strong-password"
}
```

### `POST /api/auth/login`

Body:

```json
{
  "username": "jane",
  "password": "very-strong-password"
}
```

Both return:

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

Returns the uploaded encrypted vault document or `null`.

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

This stores the encrypted vault state exactly as sent by the extension.

## Security Notes

- The server is intentionally simple and currently stores data in a JSON file.
- For higher scale or stricter operational requirements, move users/sessions/vault metadata to a proper database.
- Session tokens are hashed before storage.
- Account passwords are hashed with `scrypt`.
- The extension uploads encrypted secrets, not plaintext secrets.
