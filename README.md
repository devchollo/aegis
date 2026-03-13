# Aegis Chrome Extension

Aegis is a Manifest V3 Chrome extension built with React, TypeScript, Vite, Tailwind CSS, shadcn-style UI components, and the Web Crypto API. It stores credentials and secure notes locally in `chrome.storage.local` and encrypts secrets with a key derived from a master password via PBKDF2.

## Features

- Master password setup and unlock flow
- AES-GCM encryption for stored passwords and note bodies
- Local-only storage with `chrome.storage.local`
- Optional Aegis Sync account backed by a Render-deployable Node service
- Popup for current-site matching, quick save, quick notes, autofill, and captured-login review
- Options dashboard for full credential, note, and security management
- Configurable auto-lock timeout
- Re-authentication flow for reveals and plaintext export/import
- Explicit user-initiated autofill with DOM event dispatching for controlled inputs
- Plaintext Aegis export after password confirmation, plus import that re-encrypts with the current master password
- Cross-device sync uploads the already-encrypted vault blob, not decrypted secrets

## Project Structure

```text
vault-extension/
|- manifest.json
|- options.html
|- package.json
|- popup.html
|- postcss.config.js
|- README.md
|- render.yaml
|- sync-server/
|  |- README.md
|  `- server.mjs
|- tailwind.config.ts
|- tsconfig.json
|- tsconfig.node.json
|- vite.config.ts
`- src/
   |- background/
   |  `- index.ts
   |- components/
   |  |- auth-card.tsx
   |  |- credential-dialog.tsx
   |  |- empty-state.tsx
   |  |- note-dialog.tsx
   |  |- reauth-dialog.tsx
   |  `- ui/
   |     |- alert.tsx
   |     |- badge.tsx
   |     |- button.tsx
   |     |- card.tsx
   |     |- dialog.tsx
   |     |- input.tsx
   |     |- label.tsx
   |     |- scroll-area.tsx
   |     |- separator.tsx
   |     |- switch.tsx
   |     |- tabs.tsx
   |     `- textarea.tsx
   |- content/
   |  `- index.ts
   |- lib/
   |  |- password.ts
   |  `- utils.ts
   |- options/
   |  |- App.tsx
   |  `- main.tsx
   |- popup/
   |  |- App.tsx
   |  `- main.tsx
   |- shared/
   |  |- constants.ts
   |  |- crypto.ts
   |  |- match.ts
   |  |- messaging.ts
   |  |- storage.ts
   |  |- types.ts
   |  `- validators.ts
   |- styles/
   |  `- globals.css
   `- vite-env.d.ts
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the extension:

   ```bash
   npm run build
   ```

3. Load it in Chrome:
   - Open `chrome://extensions`
   - Enable Developer Mode
   - Click `Load unpacked`
   - Select the generated `dist` folder

## Optional Sync Backend

Run the included sync server locally:

```bash
npm run sync:server
```

Then use `http://localhost:3000` as the sync server URL inside Aegis.

For Render deployment:

- deploy the root repo with [render.yaml](./render.yaml)
- attach a persistent disk
- use your deployed service URL, for example `https://aegis-sync.onrender.com`
- connect that account from the Aegis setup screen or the dashboard Security tab

## Development

Use build watch mode while editing:

```bash
npm run dev
```

Then reload the extension in `chrome://extensions` after changes.

## How Components Communicate

- Popup and options pages send typed `chrome.runtime.sendMessage` requests to the background service worker.
- The background service worker is the security boundary:
  - derives keys
  - verifies the master password
  - encrypts and decrypts secrets
  - reads and writes `chrome.storage.local`
  - enforces lock state and re-authentication requirements
- When sync is enabled, the background worker also uploads the encrypted `VaultState` blob to the sync backend after local mutations.
- On a new device, signing in to an Aegis Sync account can download the encrypted vault before unlock, after which the user unlocks with the same master password.
- The background worker sends targeted messages to the content script only for:
  - login-form detection
  - explicit fill requests initiated by the user
- The content script never persists secrets and only receives decrypted username/password values during a fill action.
- After a detected login submission, the content script can send a one-time in-memory capture to the background worker so the popup can offer a prefilled save flow.

## Build Notes

- Vite builds the React popup and options pages.
- A small Vite plugin runs esbuild for the MV3 background service worker and content script so the manifest gets stable filenames (`background.js` and `content.js`).
- `manifest.json` is copied into `dist` during the build.

## Security Notes

- Master passwords are never stored directly.
- Aegis derives an AES-GCM key from the master password using PBKDF2 with a random salt.
- Password values and note bodies are encrypted individually with unique IVs.
- Decrypted secrets stay in memory only inside the background service worker session.
- Export files contain plaintext credentials and note bodies after re-authentication. They do not include the plaintext master password.
- Aegis Sync stores only the encrypted vault state plus sync account metadata; the backend never receives the master password.
- Auto-lock is enforced from session metadata and background memory is cleared on worker suspend.
- Origin matching is the default and safer site matching mode.
- Autofill is explicit and blocked on non-matching domains.

## Limitations

- Session state survives normal MV3 worker unloads through `chrome.storage.session`, but still resets on browser restart, extension reload, or manual lock.
- Imported vaults replace the current vault wholesale and are re-encrypted with the currently unlocked master password.
- Notes encrypt the body, not the title, so note titles should avoid highly sensitive plaintext.
- The included sync backend is intentionally simple. For production use at scale, move account/session storage from the local JSON file to a managed database.
