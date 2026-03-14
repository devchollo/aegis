# Aegis

<p align="center">
  <img src="./aegis-logo.png" alt="Aegis logo" width="120" />
</p>

Aegis is a Chrome Extension password vault built on Manifest V3. It stores website credentials and secure notes locally, encrypts secrets with a master-password-derived key, and optionally syncs the already-encrypted vault to your own backend.

This repo includes:

- the Chrome extension
- the optional `sync-server` backend
- a local-only workflow with no backend required

## What Aegis Does

- Stores credentials for websites
- Detects login forms and offers save/fill prompts
- Autofills matching credentials only on approved sites
- Stores secure notes with encrypted bodies
- Locks and unlocks with a master password
- Supports optional cross-device sync through your own server
- Exports plaintext backups only after re-authentication

## Security Model

Aegis is designed so the extension, not the backend, is the trust boundary for secrets.

- Master passwords are never stored directly.
- PBKDF2 with a random salt derives the local AES-GCM key.
- Password values and note bodies are encrypted individually before persistence.
- Encrypted data is stored in `chrome.storage.local`.
- Session key material is kept in memory and `chrome.storage.session`, not plaintext disk storage.
- Sync uploads the encrypted vault state blob, not decrypted passwords or note bodies.
- Autofill is explicit and origin-aware by default.
- Export requires a fresh password check and produces plaintext data by design.

Important:

- The sync backend authenticates users, but it does not know the Aegis master password.
- If a user loses their master password, the encrypted vault cannot be decrypted.
- Plaintext exports are sensitive and must be stored carefully.

## Tech Stack

- Chrome Extension Manifest V3
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn-style component setup
- lucide-react
- Web Crypto API
- `chrome.storage.local`
- Optional sync backend: Express + PostgreSQL

## Project Structure

```text
.
├─ manifest.json
├─ popup.html
├─ options.html
├─ package.json
├─ vite.config.ts
├─ tailwind.config.ts
├─ postcss.config.js
├─ src/
│  ├─ background/
│  ├─ content/
│  ├─ popup/
│  ├─ options/
│  ├─ components/
│  ├─ shared/
│  ├─ lib/
│  └─ styles/
└─ sync-server/
   ├─ server.mjs
   ├─ package.json
   ├─ schema.sql
   ├─ .env.example
   └─ README.md
```

## Quick Start

### 1. Install extension dependencies

```bash
npm install
```

### 2. Build the extension

```bash
npm run build
```

### 3. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the repo `dist` folder

Always load `dist`, not the repo root.

## Local-Only Usage

You do not need a backend to use Aegis.

1. Build and load the extension
2. Open the popup
3. Create a local master password
4. Save credentials and notes locally

In local-only mode:

- everything remains on that browser profile
- no data leaves the machine
- sync UI can be ignored entirely

## Self-Hosted Sync

The optional sync backend lets you use the same encrypted vault across devices. The backend stores:

- sync account records
- session tokens
- the encrypted vault blob

The backend does not store decrypted secrets unless you export plaintext data yourself outside the extension.

### Run the backend locally

```bash
cd sync-server
npm install
npm run dev
```

Set up PostgreSQL first, then configure `DATABASE_URL`.

Use:

- `http://localhost:3000` as the server URL inside Aegis

### Backend environment

See [sync-server/.env.example](/c:/Users/devch/Desktop/vault-extension/sync-server/.env.example).

Key variables:

- `DATABASE_URL`
- `PGSSL`
- `AEGIS_SESSION_TTL_MS`
- `AEGIS_KEEPALIVE_ENABLED`
- `AEGIS_KEEPALIVE_INTERVAL_MS`
- `AEGIS_KEEPALIVE_URL`

### Deploy your own sync server

The recommended public setup in this repo is:

- Express app
- PostgreSQL database
- Render web service or any Node host

For detailed backend deployment steps, read [sync-server/README.md](/c:/Users/devch/Desktop/vault-extension/sync-server/README.md).

## How Sync Works

1. User signs in or creates a sync account against a chosen server URL.
2. Aegis authenticates with the backend and receives a session token.
3. Local vault changes upload the encrypted `VaultState` blob.
4. Other devices can sign in to the same sync account and download the encrypted vault.
5. The user still needs the correct Aegis master password to unlock and decrypt it.

Important sync behavior:

- Sync identity is scoped by `serverUrl + username`.
- A different username must not see another user’s local vault.
- If sync is disconnected on one device, local-only use can continue.
- Sync polling is throttled and metadata-first to avoid noisy full downloads.

## Extension Architecture

### Popup

The popup is the compact day-to-day UI. It shows:

- lock state
- current site match status
- matching credentials
- fill actions
- quick save credential
- quick note creation
- captured login review

### Options Dashboard

The dashboard is the full management UI. It provides:

- credential management
- secure notes management
- search and filtering
- security settings
- sync controls
- export and import

### Background Service Worker

The background worker is the sensitive core. It:

- verifies and unlocks the vault
- derives and restores session keys
- encrypts and decrypts secrets
- reads and writes storage
- enforces re-authentication rules
- mediates sync operations
- prevents broad plaintext exposure

### Content Script

The content script:

- detects likely login forms
- reads draft username/password fields
- captures submitted logins
- receives explicit fill requests
- dispatches input/change events for modern frontends

## Messaging Flow

Communication is explicit and typed.

- Popup and options pages talk to the background via `chrome.runtime.sendMessage`.
- The background talks to the content script with targeted tab messages.
- The content script never gets full vault state.
- Decrypted credentials are sent to the page only during explicit autofill.

Typical flow:

1. Content script detects a login form.
2. Popup asks background for current site state.
3. Background checks matching credentials.
4. User clicks `Fill`.
5. Background decrypts only that credential.
6. Content script fills the page inputs and dispatches DOM events.

## Development

### Watch mode

```bash
npm run dev
```

This rebuilds the extension on changes. Chrome still needs an extension reload.

### Type check

```bash
npm run typecheck
```

### Production build

```bash
npm run build
```

### Run backend from the root repo

```bash
npm run sync:server
```

## Using Sync Across Devices

1. On device A, create or unlock your vault.
2. Connect a sync account and enable sync.
3. On device B, open Aegis and sign in to the same sync account.
4. Let Aegis download the encrypted vault.
5. Unlock with the same Aegis master password used for that vault.

The sync account password and the Aegis master password may be the same or different, but they are not the same system:

- sync account password authenticates with the backend
- master password decrypts the vault locally

## Backup and Recovery

### Export

- Export requires re-authentication
- Exported JSON contains plaintext credentials and note bodies
- Export files should be treated like raw secrets

### Import

- Import replaces the current vault contents
- Imported plaintext data is immediately re-encrypted with the current unlocked master password

## Known Limitations

- Note titles remain plaintext; only note bodies are encrypted.
- Chrome MV3 worker lifecycle can still end an active session after reload/restart or manual lock.
- Import is full replacement, not merge.
- The sync backend is intentionally minimal and does not yet support multi-factor auth, audit logs, or advanced conflict resolution.
- Polling is throttled, but sync is not real-time websocket replication.

## Privacy Notes

- Aegis does not require any cloud service for local use.
- If you enable sync, you are responsible for your chosen backend and database.
- This repo is suitable for self-hosting, local experimentation, and personal deployment.

## Troubleshooting

### The extension changes are not showing up

- Rebuild with `npm run build`
- Reload the unpacked extension
- Make sure Chrome is loading `dist`

### Sync login works but vault data does not appear

- Confirm both devices use the same sync account
- Confirm both devices use the same Aegis master password for that vault
- Check the backend health endpoints:
  - `/health`
  - `/ready`
- Check the server URL configured inside Aegis

### A page does not autofill correctly

- Some sites use custom or multi-step authentication flows
- Try opening the popup and filling explicitly
- If the DOM is highly custom, site-specific handling may be required

### Exported file is plaintext

That is expected. Export is intentionally decrypted after password confirmation.
