// src/shared/constants.ts
var STORAGE_KEY = "vault-state";
var SYNC_STORAGE_KEY = "vault-sync-state";
var SESSION_CAPTURE_KEY = "pending-login-captures";
var SESSION_AUTH_KEY = "vault-auth-session";
var VAULT_VERSION = 1;
var DEFAULT_KDF_ITERATIONS = 31e4;
var AUTH_CHECK_VALUE = "vault-auth-check::v1";
var DEFAULT_SETTINGS = {
  autoLockMinutes: 15,
  requireReauthForReveal: true
};
var SENSITIVE_AUTH_WINDOW_MS = 5 * 60 * 1e3;
var MIN_AUTO_LOCK_MINUTES = 1;
var MAX_AUTO_LOCK_MINUTES = 240;
var LOGIN_CAPTURE_TTL_MS = 10 * 60 * 1e3;
var REMOTE_SYNC_CHECK_INTERVAL_MS = 60 * 1e3;

// src/shared/crypto.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}
async function importPasswordKey(password) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
}
async function deriveVaultKey(password, saltB64, iterations = DEFAULT_KDF_ITERATIONS, extractable = true) {
  const passwordKey = await importPasswordKey(password);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltB64),
      iterations,
      hash: "SHA-256"
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256
    },
    extractable,
    ["encrypt", "decrypt"]
  );
}
async function encryptText(key, value) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value)
  );
  return {
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    ivB64: bytesToBase64(iv)
  };
}
async function decryptText(key, ciphertextB64, ivB64) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(ivB64)
    },
    key,
    base64ToBytes(ciphertextB64)
  );
  return decoder.decode(plaintext);
}
async function createVaultMeta(password) {
  const salt = randomBytes(16);
  const saltB64 = bytesToBase64(salt);
  const key = await deriveVaultKey(password, saltB64, DEFAULT_KDF_ITERATIONS, true);
  const authCheck = await encryptText(key, AUTH_CHECK_VALUE);
  return {
    key,
    meta: {
      version: VAULT_VERSION,
      saltB64,
      kdf: "PBKDF2",
      iterations: DEFAULT_KDF_ITERATIONS,
      hash: "SHA-256",
      authCheckCiphertextB64: authCheck.ciphertextB64,
      authCheckIvB64: authCheck.ivB64
    }
  };
}
async function verifyVaultPassword(password, meta) {
  try {
    const key = await deriveVaultKey(password, meta.saltB64, meta.iterations, true);
    const decrypted = await decryptText(
      key,
      meta.authCheckCiphertextB64,
      meta.authCheckIvB64
    );
    return decrypted === AUTH_CHECK_VALUE ? key : null;
  } catch {
    return null;
  }
}
async function exportSessionKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(raw));
}
async function importSessionKey(rawKeyB64) {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(rawKeyB64),
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

// src/shared/match.ts
function isSupportedSiteUrl(input) {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function siteMatchesCredential(siteUrl, credential) {
  if (!isSupportedSiteUrl(siteUrl)) {
    return false;
  }
  const site = new URL(siteUrl);
  if (credential.siteMatchMode === "origin") {
    return site.origin === credential.siteOrigin;
  }
  return site.hostname === credential.siteHostname;
}

// src/shared/validators.ts
function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isOptionalText(value) {
  return value === void 0 || typeof value === "string";
}
function clampAutoLockMinutes(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.autoLockMinutes;
  }
  return Math.min(MAX_AUTO_LOCK_MINUTES, Math.max(MIN_AUTO_LOCK_MINUTES, Math.round(value)));
}
function normalizeSettings(settings) {
  return {
    autoLockMinutes: clampAutoLockMinutes(settings?.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes),
    requireReauthForReveal: typeof settings?.requireReauthForReveal === "boolean" ? settings.requireReauthForReveal : DEFAULT_SETTINGS.requireReauthForReveal
  };
}
function validateMasterPassword(password) {
  return password.trim().length >= 10;
}
function normalizeSyncServerUrl(value) {
  const parsed = new URL(value.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Sync server must use http or https.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}
function validateSyncCredentials(input) {
  try {
    normalizeSyncServerUrl(input.serverUrl);
  } catch {
    return { valid: false, message: "Sync server URL is invalid." };
  }
  if (!hasText(input.username) || input.username.trim().length < 3) {
    return { valid: false, message: "Username must be at least 3 characters." };
  }
  if (!hasText(input.password) || input.password.length < 10) {
    return { valid: false, message: "Password must be at least 10 characters." };
  }
  if (input.mode !== "login" && input.mode !== "register") {
    return { valid: false, message: "Sync mode is invalid." };
  }
  return { valid: true };
}
function validateSaveCredentialInput(input) {
  if (!hasText(input.siteOrigin)) {
    return { valid: false, message: "Site origin is required." };
  }
  try {
    const origin = new URL(input.siteOrigin);
    if (origin.origin !== input.siteOrigin) {
      return { valid: false, message: "Use a normalized origin like https://example.com." };
    }
    if (!["http:", "https:"].includes(origin.protocol)) {
      return { valid: false, message: "Only http and https sites are supported." };
    }
  } catch {
    return { valid: false, message: "Site origin is invalid." };
  }
  if (!hasText(input.username)) {
    return { valid: false, message: "Username or email is required." };
  }
  if (!input.id && !hasText(input.password)) {
    return { valid: false, message: "Password is required." };
  }
  if (!isOptionalText(input.label) || !isOptionalText(input.loginUrl)) {
    return { valid: false, message: "Optional fields must be text." };
  }
  if (input.loginUrl) {
    try {
      new URL(input.loginUrl);
    } catch {
      return { valid: false, message: "Login URL is invalid." };
    }
  }
  if (!isSiteMatchMode(input.siteMatchMode)) {
    return { valid: false, message: "Site matching mode is invalid." };
  }
  return { valid: true };
}
function validateSaveNoteInput(input) {
  if (!hasText(input.title)) {
    return { valid: false, message: "Note title is required." };
  }
  if (!hasText(input.body)) {
    return { valid: false, message: "Note body is required." };
  }
  return { valid: true };
}
function isSiteMatchMode(value) {
  return value === "origin" || value === "hostname";
}
function isVaultMeta(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const meta = value;
  return typeof meta.version === "number" && hasText(meta.saltB64) && meta.kdf === "PBKDF2" && typeof meta.iterations === "number" && meta.hash === "SHA-256" && hasText(meta.authCheckCiphertextB64) && hasText(meta.authCheckIvB64);
}
function isVaultCredential(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const credential = value;
  return hasText(credential.id) && hasText(credential.siteOrigin) && hasText(credential.siteHostname) && isSiteMatchMode(credential.siteMatchMode) && isOptionalText(credential.loginUrl) && hasText(credential.username) && hasText(credential.passwordCiphertextB64) && hasText(credential.passwordIvB64) && isOptionalText(credential.label) && typeof credential.createdAt === "number" && typeof credential.updatedAt === "number";
}
function isVaultNote(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const note = value;
  return hasText(note.id) && hasText(note.title) && hasText(note.bodyCiphertextB64) && hasText(note.bodyIvB64) && typeof note.createdAt === "number" && typeof note.updatedAt === "number";
}
function isVaultState(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const state = value;
  return (state.meta === void 0 || isVaultMeta(state.meta)) && Array.isArray(state.credentials) && state.credentials.every(isVaultCredential) && Array.isArray(state.notes) && state.notes.every(isVaultNote) && typeof state.settings === "object";
}
function isVaultExportBundle(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const bundle = value;
  return typeof bundle.version === "number" && typeof bundle.exportedAt === "number" && Array.isArray(bundle.credentials) && bundle.credentials.every(
    (credential) => hasText(credential.id) && hasText(credential.siteOrigin) && hasText(credential.siteHostname) && isSiteMatchMode(credential.siteMatchMode) && hasText(credential.username) && hasText(credential.password) && isOptionalText(credential.loginUrl) && isOptionalText(credential.label) && typeof credential.createdAt === "number" && typeof credential.updatedAt === "number"
  ) && Array.isArray(bundle.notes) && bundle.notes.every(
    (note) => hasText(note.id) && hasText(note.title) && hasText(note.body) && typeof note.createdAt === "number" && typeof note.updatedAt === "number"
  ) && typeof bundle.settings === "object";
}

// src/shared/messaging.ts
async function sendTabMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function hasString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isRuntimeMessage(value) {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "vault.getStatus":
    case "vault.lock":
    case "vault.getPopupData":
    case "vault.listCredentials":
    case "vault.listNotes":
    case "vault.exportData":
    case "vault.getSyncStatus":
    case "vault.disconnectSyncAccount":
    case "vault.syncNow":
      return true;
    case "vault.captureLoginSubmission":
      return isRecord(value.payload) && hasString(value.payload.username) && hasString(value.payload.password);
    case "vault.dismissCapturedCredential":
      return isRecord(value.payload) && (value.payload.tabId === void 0 || typeof value.payload.tabId === "number");
    case "vault.getCapturePrompt":
      return isRecord(value.payload) && (value.payload.tabId === void 0 || typeof value.payload.tabId === "number") && (value.payload.draftUsername === void 0 || typeof value.payload.draftUsername === "string") && (value.payload.hasDraftPassword === void 0 || typeof value.payload.hasDraftPassword === "boolean");
    case "vault.savePendingCapture":
      return isRecord(value.payload) && (value.payload.tabId === void 0 || typeof value.payload.tabId === "number") && (value.payload.siteMatchMode === void 0 || isSiteMatchMode(value.payload.siteMatchMode)) && (value.payload.label === void 0 || typeof value.payload.label === "string");
    case "vault.initialize":
    case "vault.unlock":
    case "vault.reauthenticate":
      return isRecord(value.payload) && typeof value.payload.masterPassword === "string";
    case "vault.saveCredential":
      return isRecord(value.payload) && hasString(value.payload.siteOrigin) && hasString(value.payload.username) && typeof value.payload.password === "string" && isSiteMatchMode(value.payload.siteMatchMode) && (value.payload.id === void 0 || typeof value.payload.id === "string") && (value.payload.loginUrl === void 0 || typeof value.payload.loginUrl === "string") && (value.payload.label === void 0 || typeof value.payload.label === "string");
    case "vault.deleteCredential":
    case "vault.getCredentialSecret":
      return isRecord(value.payload) && hasString(value.payload.credentialId);
    case "vault.fillCredential":
      return isRecord(value.payload) && hasString(value.payload.credentialId) && (value.payload.tabId === void 0 || typeof value.payload.tabId === "number");
    case "vault.getNoteBody":
    case "vault.deleteNote":
      return isRecord(value.payload) && hasString(value.payload.noteId);
    case "vault.saveNote":
      return isRecord(value.payload) && hasString(value.payload.title) && hasString(value.payload.body) && (value.payload.id === void 0 || typeof value.payload.id === "string");
    case "vault.updateSettings":
      return isRecord(value.payload) && typeof value.payload.autoLockMinutes === "number" && typeof value.payload.requireReauthForReveal === "boolean";
    case "vault.importData":
      return isRecord(value.payload) && isVaultExportBundle(value.payload.bundle);
    case "vault.connectSyncAccount":
      return isRecord(value.payload) && typeof value.payload.serverUrl === "string" && typeof value.payload.username === "string" && typeof value.payload.password === "string" && (value.payload.mode === "login" || value.payload.mode === "register") && (value.payload.enableSync === void 0 || typeof value.payload.enableSync === "boolean");
    case "vault.setSyncEnabled":
      return isRecord(value.payload) && typeof value.payload.enabled === "boolean";
    default:
      return false;
  }
}

// src/shared/sync.ts
async function request(serverUrl, path, init, authToken) {
  const response = await fetch(`${normalizeSyncServerUrl(serverUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authToken ? { Authorization: `Bearer ${authToken}` } : {},
      ...init.headers ?? {}
    }
  });
  if (!response.ok) {
    const message = await response.json().then((body) => typeof body?.error === "string" ? body.error : null).catch(() => null);
    throw new Error(message ?? `Sync request failed with ${response.status}.`);
  }
  if (response.status === 204) {
    return null;
  }
  return await response.json();
}
async function authenticateSyncAccount(input) {
  const endpoint = input.mode === "register" ? "/api/auth/register" : "/api/auth/login";
  return request(
    input.serverUrl,
    endpoint,
    {
      method: "POST",
      body: JSON.stringify({
        username: input.username.trim(),
        password: input.password
      })
    }
  );
}
async function fetchRemoteVault(serverUrl, authToken) {
  return request(
    serverUrl,
    "/api/vault",
    { method: "GET" },
    authToken
  );
}
async function fetchRemoteVaultMeta(serverUrl, authToken) {
  return request(
    serverUrl,
    "/api/vault/meta",
    { method: "GET" },
    authToken
  );
}
async function uploadRemoteVault(serverUrl, authToken, state) {
  return request(
    serverUrl,
    "/api/vault",
    {
      method: "PUT",
      body: JSON.stringify({ state })
    },
    authToken
  );
}

// src/shared/storage.ts
function cloneDefaultState() {
  return {
    credentials: [],
    notes: [],
    settings: { ...DEFAULT_SETTINGS }
  };
}
async function readVaultState() {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const state = raw[STORAGE_KEY];
  if (!state) {
    return cloneDefaultState();
  }
  return {
    meta: state.meta,
    credentials: Array.isArray(state.credentials) ? state.credentials : [],
    notes: Array.isArray(state.notes) ? state.notes : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...state.settings ?? {}
    }
  };
}
async function writeVaultState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
async function readSyncState() {
  const raw = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  const state = raw[SYNC_STORAGE_KEY];
  if (!state) {
    return { enabled: false };
  }
  return {
    enabled: Boolean(state.enabled),
    serverUrl: typeof state.serverUrl === "string" ? state.serverUrl : void 0,
    username: typeof state.username === "string" ? state.username : void 0,
    authToken: typeof state.authToken === "string" ? state.authToken : void 0,
    lastSyncedAt: typeof state.lastSyncedAt === "number" ? state.lastSyncedAt : void 0,
    lastLocalChangeAt: typeof state.lastLocalChangeAt === "number" ? state.lastLocalChangeAt : void 0,
    lastRemoteCheckAt: typeof state.lastRemoteCheckAt === "number" ? state.lastRemoteCheckAt : void 0,
    lastSyncError: typeof state.lastSyncError === "string" ? state.lastSyncError : void 0
  };
}
async function writeSyncState(state) {
  await chrome.storage.local.set({ [SYNC_STORAGE_KEY]: state });
}

// src/background/index.ts
var session = null;
async function readPersistedSession() {
  const raw = await chrome.storage.session.get(SESSION_AUTH_KEY);
  return raw[SESSION_AUTH_KEY];
}
async function writePersistedSession(next) {
  if (next) {
    await chrome.storage.session.set({ [SESSION_AUTH_KEY]: next });
    return;
  }
  await chrome.storage.session.remove(SESSION_AUTH_KEY);
}
async function readPendingLoginCaptures() {
  const raw = await chrome.storage.session.get(SESSION_CAPTURE_KEY);
  const captures = raw[SESSION_CAPTURE_KEY];
  return captures ?? {};
}
async function writePendingLoginCaptures(captures) {
  await chrome.storage.session.set({ [SESSION_CAPTURE_KEY]: captures });
}
function ok(data) {
  return { ok: true, data };
}
function fail(code, message) {
  return {
    ok: false,
    error: { code, message }
  };
}
function toSyncStatus(sync) {
  return {
    enabled: sync.enabled,
    authenticated: Boolean(sync.serverUrl && sync.username && sync.authToken),
    serverUrl: sync.serverUrl,
    username: sync.username,
    lastSyncedAt: sync.lastSyncedAt,
    lastLocalChangeAt: sync.lastLocalChangeAt,
    lastRemoteCheckAt: sync.lastRemoteCheckAt,
    lastSyncError: sync.lastSyncError
  };
}
function lockSession() {
  session = null;
  void writePersistedSession(null);
}
async function pruneCapturedCredentials() {
  const cutoff = Date.now() - LOGIN_CAPTURE_TTL_MS;
  const captures = await readPendingLoginCaptures();
  let changed = false;
  for (const [tabId, capture] of Object.entries(captures)) {
    if (capture.capturedAt < cutoff) {
      delete captures[tabId];
      changed = true;
    }
  }
  if (changed) {
    await writePendingLoginCaptures(captures);
  }
}
async function persistSession() {
  if (!session?.key) {
    await writePersistedSession(null);
    return;
  }
  await writePersistedSession({
    rawKeyB64: await exportSessionKey(session.key),
    unlockedAt: session.unlockedAt,
    lastActiveAt: session.lastActiveAt,
    sensitiveAuthAt: session.sensitiveAuthAt
  });
}
function touchSession({ sensitive = false } = {}) {
  if (!session) {
    return;
  }
  const now = Date.now();
  session.lastActiveAt = now;
  if (sensitive) {
    session.sensitiveAuthAt = now;
  }
  void persistSession();
}
async function maybeSyncVaultState(state) {
  const sync = await readSyncState();
  const changedAt = Date.now();
  if (!sync.enabled || !sync.serverUrl || !sync.authToken) {
    await writeSyncState({
      ...sync,
      lastLocalChangeAt: changedAt
    });
    return { ok: false, error: "Sync is not enabled on this device." };
  }
  try {
    const response = await uploadRemoteVault(sync.serverUrl, sync.authToken, state);
    await writeSyncState({
      ...sync,
      lastLocalChangeAt: response.updatedAt,
      lastSyncedAt: response.updatedAt,
      lastRemoteCheckAt: Date.now(),
      lastSyncError: void 0
    });
    return { ok: true, updatedAt: response.updatedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aegis failed to sync the encrypted vault.";
    await writeSyncState({
      ...sync,
      lastLocalChangeAt: changedAt,
      lastSyncError: message
    });
    return { ok: false, error: message };
  }
}
async function persistVaultState(state, options = {}) {
  await writeVaultState(state);
  if (options.sync !== false) {
    await maybeSyncVaultState(state);
    return;
  }
  const sync = await readSyncState();
  await writeSyncState({
    ...sync,
    lastLocalChangeAt: Date.now()
  });
}
async function maybeRefreshVaultFromRemote(options = {}) {
  const sync = await readSyncState();
  if (!sync.enabled || !sync.serverUrl || !sync.authToken) {
    return { refreshed: false, state: await readVaultState() };
  }
  const now = Date.now();
  if (!options.force && sync.lastRemoteCheckAt && now - sync.lastRemoteCheckAt < REMOTE_SYNC_CHECK_INTERVAL_MS) {
    return { refreshed: false, state: await readVaultState() };
  }
  const localState = await readVaultState();
  try {
    const remoteMeta = await fetchRemoteVaultMeta(sync.serverUrl, sync.authToken);
    const remoteUpdatedAt = remoteMeta.vault?.updatedAt;
    const hasUnsyncedLocalChanges = typeof sync.lastLocalChangeAt === "number" && typeof sync.lastSyncedAt === "number" && sync.lastLocalChangeAt > sync.lastSyncedAt;
    const shouldFetchFullRemote = typeof remoteUpdatedAt === "number" && (!localState.meta || isVaultContentEmpty(localState) || (sync.lastSyncedAt === void 0 || remoteUpdatedAt > sync.lastSyncedAt) && !hasUnsyncedLocalChanges);
    if (shouldFetchFullRemote) {
      const remote = await fetchRemoteVault(sync.serverUrl, sync.authToken);
      const remoteState = isVaultState(remote.vault?.state) ? remote.vault.state : null;
      if (remoteState) {
        await writeVaultState(remoteState);
        await writeSyncState({
          ...sync,
          lastSyncedAt: remoteUpdatedAt,
          lastLocalChangeAt: remoteUpdatedAt,
          lastRemoteCheckAt: now,
          lastSyncError: void 0
        });
        return { refreshed: true, state: remoteState };
      }
    }
    if (!remoteUpdatedAt && (localState.meta || !isVaultContentEmpty(localState))) {
      await writeSyncState({
        ...sync,
        lastRemoteCheckAt: now,
        lastSyncError: void 0
      });
      return { refreshed: false, state: localState };
    }
    await writeSyncState({
      ...sync,
      lastRemoteCheckAt: now,
      lastSyncError: void 0
    });
    return { refreshed: false, state: localState };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aegis failed to refresh from the sync backend.";
    await writeSyncState({
      ...sync,
      lastRemoteCheckAt: now,
      lastSyncError: message
    });
    return { refreshed: false, state: localState };
  }
}
function toCredentialSummary(credential) {
  const { passwordCiphertextB64, passwordIvB64, ...summary } = credential;
  return summary;
}
function toNoteSummary(note) {
  const { bodyCiphertextB64, bodyIvB64, ...summary } = note;
  return summary;
}
function normalizeUsername(value) {
  return value.trim().toLowerCase();
}
function sortCredentials(credentials) {
  return [...credentials].sort((left, right) => right.updatedAt - left.updatedAt);
}
function sortNotes(notes) {
  return [...notes].sort((left, right) => right.updatedAt - left.updatedAt);
}
function isVaultContentEmpty(state) {
  return state.credentials.length === 0 && state.notes.length === 0;
}
async function getCapturedCredentialForSite(site) {
  if (!site?.tabId) {
    return null;
  }
  await pruneCapturedCredentials();
  const captures = await readPendingLoginCaptures();
  const capture = captures[String(site.tabId)] ?? null;
  if (!capture) {
    return null;
  }
  if (site.supported && capture.siteOrigin === site.origin) {
    return capture;
  }
  if (site.supported && capture.siteHostname === site.hostname) {
    return capture;
  }
  return null;
}
function getMatchingCredentialsForSite(state, site) {
  if (!site?.supported) {
    return [];
  }
  return sortCredentials(state.credentials).filter(
    (credential) => siteMatchesCredential(site.url, credential)
  );
}
function resolveInlinePrompt(options) {
  const { site, matchingCredentials, capture, draftUsername, hasDraftPassword } = options;
  if (!site?.supported || !site.hasLoginForm) {
    return null;
  }
  const normalizedDraftUsername = draftUsername ? normalizeUsername(draftUsername) : "";
  const exactUsernameMatch = normalizedDraftUsername ? matchingCredentials.find(
    (credential) => normalizeUsername(credential.username) === normalizedDraftUsername
  ) : void 0;
  if (exactUsernameMatch) {
    return {
      kind: "fill",
      siteOrigin: site.origin,
      credentialId: exactUsernameMatch.id,
      username: exactUsernameMatch.username,
      label: exactUsernameMatch.label,
      matchReason: "typed-username"
    };
  }
  if (!normalizedDraftUsername && matchingCredentials.length === 1) {
    const credential = matchingCredentials[0];
    return {
      kind: "fill",
      siteOrigin: site.origin,
      credentialId: credential.id,
      username: credential.username,
      label: credential.label,
      matchReason: "single-match"
    };
  }
  if (draftUsername && hasDraftPassword) {
    return {
      kind: "save",
      siteOrigin: site.origin,
      username: draftUsername.trim(),
      loginUrl: site.url,
      source: "draft"
    };
  }
  if (capture) {
    const captureUsername = normalizeUsername(capture.username);
    const existingCaptureMatch = matchingCredentials.find(
      (credential) => normalizeUsername(credential.username) === captureUsername
    );
    if (existingCaptureMatch) {
      return null;
    }
    return {
      kind: "save",
      siteOrigin: capture.siteOrigin,
      username: capture.username,
      loginUrl: capture.loginUrl,
      source: "capture"
    };
  }
  return null;
}
async function clearCapturedCredential(tabId) {
  if (typeof tabId === "number") {
    const captures = await readPendingLoginCaptures();
    delete captures[String(tabId)];
    await writePendingLoginCaptures(captures);
  }
}
function isExpired(settings) {
  if (!session) {
    return true;
  }
  return Date.now() >= session.lastActiveAt + settings.autoLockMinutes * 6e4;
}
function maybeExpireSession(settings) {
  if (session && isExpired(settings)) {
    lockSession();
  }
}
async function ensureSessionLoaded(state) {
  if (session?.key) {
    maybeExpireSession(normalizeSettings((state ?? await readVaultState()).settings));
    return session;
  }
  const persisted = await readPersistedSession();
  if (!persisted) {
    return null;
  }
  const currentState = state ?? await readVaultState();
  const settings = normalizeSettings(currentState.settings);
  if (Date.now() >= persisted.lastActiveAt + settings.autoLockMinutes * 6e4) {
    await writePersistedSession(null);
    return null;
  }
  session = {
    key: await importSessionKey(persisted.rawKeyB64),
    unlockedAt: persisted.unlockedAt,
    lastActiveAt: persisted.lastActiveAt,
    sensitiveAuthAt: persisted.sensitiveAuthAt
  };
  maybeExpireSession(settings);
  return session;
}
async function getVaultStatus(state) {
  const currentState = state ?? await maybeRefreshVaultFromRemote().then((result) => result.state);
  const settings = normalizeSettings(currentState.settings);
  await ensureSessionLoaded(currentState);
  maybeExpireSession(settings);
  return {
    initialized: Boolean(currentState.meta),
    unlocked: Boolean(session?.key),
    settings,
    lastActiveAt: session?.lastActiveAt,
    expiresAt: session ? session.lastActiveAt + settings.autoLockMinutes * 6e4 : void 0,
    sensitiveAuthExpiresAt: session ? session.sensitiveAuthAt + SENSITIVE_AUTH_WINDOW_MS : void 0
  };
}
async function requireUnlocked(state) {
  await ensureSessionLoaded(state);
  maybeExpireSession(normalizeSettings(state.settings));
  if (!state.meta) {
    return fail("NOT_INITIALIZED", "Vault has not been initialized.");
  }
  if (!session?.key) {
    return fail("VAULT_LOCKED", "Unlock Vault to continue.");
  }
  touchSession();
  return null;
}
async function requireSensitiveAccess(state, options = {}) {
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  const requireFreshAuth = options.forceReauth || normalizeSettings(state.settings).requireReauthForReveal;
  if (!requireFreshAuth) {
    return null;
  }
  if (!session) {
    return fail("VAULT_LOCKED", "Unlock Vault to continue.");
  }
  const stillValid = Date.now() < session.sensitiveAuthAt + SENSITIVE_AUTH_WINDOW_MS;
  if (!stillValid) {
    return fail("REAUTH_REQUIRED", "Re-authentication is required for this action.");
  }
  touchSession({ sensitive: true });
  return null;
}
async function getActiveTab(tabId) {
  if (typeof tabId === "number") {
    return chrome.tabs.get(tabId);
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
async function getSiteInfo(tabId) {
  const tab = await getActiveTab(tabId);
  if (!tab?.id || !tab.url) {
    return null;
  }
  let hasLoginForm = false;
  let origin = "";
  let hostname = "";
  let supported = false;
  try {
    const url = new URL(tab.url);
    supported = url.protocol === "http:" || url.protocol === "https:";
    origin = supported ? url.origin : "";
    hostname = supported ? url.hostname : "";
  } catch {
    supported = false;
  }
  if (supported) {
    try {
      const scanResponse = await sendTabMessage(tab.id, {
        type: "content.scanLoginForm"
      });
      hasLoginForm = scanResponse.ok ? scanResponse.data.hasLoginForm : false;
    } catch {
      hasLoginForm = false;
    }
  }
  return {
    tabId: tab.id,
    url: tab.url,
    origin,
    hostname,
    supported,
    hasLoginForm
  };
}
async function getPopupData(state) {
  const refreshedState = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const site = await getSiteInfo();
  await ensureSessionLoaded(refreshedState);
  const siteMatches = getMatchingCredentialsForSite(refreshedState, site);
  const totalMatches = siteMatches.length;
  const pendingCapture = await getCapturedCredentialForSite(site);
  const liveDraft = !pendingCapture && site?.supported && site.tabId ? await sendTabMessage(site.tabId, {
    type: "content.getLoginDraft"
  }).then((response) => {
    if (response.ok && response.data.hasDraft && response.data.username && response.data.password) {
      return {
        username: response.data.username,
        password: response.data.password,
        siteOrigin: site.origin,
        siteHostname: site.hostname,
        loginUrl: site.url,
        capturedAt: Date.now()
      };
    }
    return null;
  }).catch(() => null) : null;
  const saveCandidate = pendingCapture ?? liveDraft;
  const hasExistingDraftMatch = saveCandidate && siteMatches.some(
    (credential) => normalizeUsername(credential.username) === normalizeUsername(saveCandidate.username)
  );
  const capturedCredential = session?.key ? saveCandidate : null;
  return ok({
    site,
    matchingCredentials: site && site.supported && session?.key ? siteMatches.map(toCredentialSummary) : [],
    totalMatches,
    canAccessSecrets: Boolean(session?.key),
    capturedCredential: hasExistingDraftMatch ? null : capturedCredential,
    hasCapturedCredential: Boolean(saveCandidate) && !hasExistingDraftMatch,
    capturedCredentialOrigin: saveCandidate?.siteOrigin
  });
}
async function captureLoginSubmission(sender, username, password) {
  if (!sender.tab?.id || !sender.tab.url) {
    return fail("VALIDATION_ERROR", "Login captures must originate from a tab context.");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(sender.tab.url);
  } catch {
    return ok({ captured: false });
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return ok({ captured: false });
  }
  const captures = await readPendingLoginCaptures();
  captures[String(sender.tab.id)] = {
    username: username.trim(),
    password,
    siteOrigin: parsedUrl.origin,
    siteHostname: parsedUrl.hostname,
    loginUrl: sender.tab.url,
    capturedAt: Date.now()
  };
  await writePendingLoginCaptures(captures);
  return ok({ captured: true });
}
async function dismissCapturedCredential(tabId) {
  const tab = await getActiveTab(tabId).catch(() => void 0);
  if (!tab?.id) {
    return ok({ dismissed: false });
  }
  await clearCapturedCredential(tab.id);
  return ok({ dismissed: true });
}
async function getCapturePrompt(tabId, draftUsername, hasDraftPassword) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const site = await getSiteInfo(tabId);
  const capture = await getCapturedCredentialForSite(site);
  await ensureSessionLoaded(state);
  const matchingCredentials = getMatchingCredentialsForSite(state, site);
  const prompt = resolveInlinePrompt({
    site,
    matchingCredentials,
    capture,
    draftUsername,
    hasDraftPassword
  });
  return ok({
    initialized: Boolean(state.meta),
    unlocked: Boolean(session?.key),
    prompt,
    capture
  });
}
async function getSyncStatus() {
  return ok(toSyncStatus(await readSyncState()));
}
async function connectSyncAccount(payload) {
  const validation = validateSyncCredentials(payload);
  if (!validation.valid) {
    return fail("VALIDATION_ERROR", validation.message);
  }
  const serverUrl = normalizeSyncServerUrl(payload.serverUrl);
  const username = payload.username.trim();
  try {
    const auth = await authenticateSyncAccount({
      ...payload,
      serverUrl,
      username
    });
    const state = await maybeRefreshVaultFromRemote({ force: true }).then((result) => result.state);
    const remote = await fetchRemoteVault(serverUrl, auth.token);
    const remoteState = isVaultState(remote.vault?.state) ? remote.vault.state : null;
    const remoteVaultExists = Boolean(remoteState?.meta);
    let importedRemoteVault = false;
    await writeSyncState({
      enabled: payload.enableSync ?? true,
      serverUrl,
      username,
      authToken: auth.token,
      lastSyncedAt: remote.vault?.updatedAt,
      lastSyncError: void 0
    });
    if (remoteState && (!state.meta || isVaultContentEmpty(state))) {
      await persistVaultState(remoteState, { sync: false });
      await writeSyncState({
        enabled: payload.enableSync ?? true,
        serverUrl,
        username,
        authToken: auth.token,
        lastSyncedAt: remote.vault?.updatedAt,
        lastLocalChangeAt: remote.vault?.updatedAt,
        lastRemoteCheckAt: Date.now(),
        lastSyncError: void 0
      });
      importedRemoteVault = true;
    } else if (state.meta && (payload.enableSync ?? true)) {
      await maybeSyncVaultState(state);
    }
    return ok({
      status: toSyncStatus(await readSyncState()),
      importedRemoteVault,
      remoteVaultExists
    });
  } catch (error) {
    return fail(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Aegis could not connect to the sync service."
    );
  }
}
async function setSyncEnabled(enabled) {
  const sync = await readSyncState();
  if (enabled && (!sync.serverUrl || !sync.username || !sync.authToken)) {
    return fail("VALIDATION_ERROR", "Connect a sync account before enabling sync.");
  }
  const next = {
    ...sync,
    enabled
  };
  await writeSyncState(next);
  if (enabled) {
    const state = await maybeRefreshVaultFromRemote({ force: true }).then((result) => result.state);
    if (state.meta) {
      await maybeSyncVaultState(state);
    }
  }
  return ok(toSyncStatus(await readSyncState()));
}
async function disconnectSyncAccount() {
  await writeSyncState({ enabled: false });
  return ok(toSyncStatus(await readSyncState()));
}
async function syncNow() {
  const sync = await readSyncState();
  if (!sync.serverUrl || !sync.authToken) {
    return fail("VALIDATION_ERROR", "Connect a sync account before syncing.");
  }
  const state = await maybeRefreshVaultFromRemote({ force: true }).then((result2) => result2.state);
  if (!state.meta) {
    return fail("NOT_INITIALIZED", "Initialize or import a vault before syncing.");
  }
  const result = await maybeSyncVaultState(state);
  if (!result.ok) {
    return fail("INTERNAL_ERROR", result.error);
  }
  return ok(toSyncStatus(await readSyncState()));
}
async function savePendingCapture(tabId, siteMatchMode = "origin", label) {
  const state = await readVaultState();
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  const site = await getSiteInfo(tabId);
  const capture = await getCapturedCredentialForSite(site);
  if (!capture) {
    return fail("NOT_FOUND", "No captured login is available for this tab.");
  }
  const response = await saveCredential({
    siteOrigin: capture.siteOrigin,
    siteMatchMode,
    loginUrl: capture.loginUrl,
    username: capture.username,
    password: capture.password,
    label: label?.trim() || void 0
  });
  if (!response.ok) {
    return response;
  }
  const savedCredential = response.data.credentials.find(
    (credential) => credential.siteOrigin === capture.siteOrigin && credential.username === capture.username
  );
  return ok({
    saved: true,
    credentialId: savedCredential?.id ?? ""
  });
}
async function initializeVault(masterPassword) {
  const state = await maybeRefreshVaultFromRemote({ force: true }).then((result) => result.state);
  if (state.meta) {
    return fail("ALREADY_INITIALIZED", "Vault is already initialized.");
  }
  if (!validateMasterPassword(masterPassword)) {
    return fail(
      "VALIDATION_ERROR",
      "Master password must be at least 10 characters long."
    );
  }
  const created = await createVaultMeta(masterPassword);
  const nextState = {
    ...state,
    meta: created.meta,
    settings: normalizeSettings(state.settings)
  };
  await persistVaultState(nextState);
  session = {
    key: created.key,
    unlockedAt: Date.now(),
    lastActiveAt: Date.now(),
    sensitiveAuthAt: Date.now()
  };
  await persistSession();
  return ok(await getVaultStatus(nextState));
}
async function unlockVault(masterPassword) {
  const state = await maybeRefreshVaultFromRemote({ force: true }).then((result) => result.state);
  if (!state.meta) {
    return fail("NOT_INITIALIZED", "Vault has not been initialized.");
  }
  const key = await verifyVaultPassword(masterPassword, state.meta);
  if (!key) {
    return fail("INVALID_PASSWORD", "Master password is incorrect.");
  }
  const now = Date.now();
  session = {
    key,
    unlockedAt: now,
    lastActiveAt: now,
    sensitiveAuthAt: now
  };
  await persistSession();
  return ok(await getVaultStatus(state));
}
async function reauthenticateVault(masterPassword) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  if (!state.meta) {
    return fail("NOT_INITIALIZED", "Vault has not been initialized.");
  }
  const key = await verifyVaultPassword(masterPassword, state.meta);
  if (!key) {
    return fail("INVALID_PASSWORD", "Master password is incorrect.");
  }
  const now = Date.now();
  session = {
    key,
    unlockedAt: session?.unlockedAt ?? now,
    lastActiveAt: now,
    sensitiveAuthAt: now
  };
  await persistSession();
  return ok(await getVaultStatus(state));
}
async function saveCredential(payload) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  const validation = validateSaveCredentialInput(payload);
  if (!validation.valid) {
    return fail("VALIDATION_ERROR", validation.message);
  }
  const parsedOrigin = new URL(payload.siteOrigin);
  const now = Date.now();
  const existing = payload.id ? state.credentials.find((credential2) => credential2.id === payload.id) : void 0;
  if (payload.id && !existing) {
    return fail("NOT_FOUND", "Credential not found.");
  }
  let passwordCiphertextB64 = existing?.passwordCiphertextB64 ?? "";
  let passwordIvB64 = existing?.passwordIvB64 ?? "";
  if (payload.password) {
    const encrypted = await encryptText(session.key, payload.password);
    passwordCiphertextB64 = encrypted.ciphertextB64;
    passwordIvB64 = encrypted.ivB64;
  }
  if (!passwordCiphertextB64 || !passwordIvB64) {
    return fail("VALIDATION_ERROR", "Password is required.");
  }
  const credential = {
    id: existing?.id ?? crypto.randomUUID(),
    siteOrigin: parsedOrigin.origin,
    siteHostname: parsedOrigin.hostname,
    siteMatchMode: payload.siteMatchMode,
    loginUrl: payload.loginUrl?.trim() || void 0,
    username: payload.username.trim(),
    passwordCiphertextB64,
    passwordIvB64,
    label: payload.label?.trim() || void 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const credentials = existing ? state.credentials.map((item) => item.id === existing.id ? credential : item) : [...state.credentials, credential];
  const nextState = {
    ...state,
    credentials: sortCredentials(credentials)
  };
  await persistVaultState(nextState);
  const captures = await readPendingLoginCaptures();
  let changed = false;
  for (const [tabId, capture] of Object.entries(captures)) {
    if (capture.siteOrigin === credential.siteOrigin && capture.username === credential.username) {
      delete captures[tabId];
      changed = true;
    }
  }
  if (changed) {
    await writePendingLoginCaptures(captures);
  }
  return ok({
    credentials: nextState.credentials.map(toCredentialSummary)
  });
}
async function deleteCredential(credentialId) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  const exists = state.credentials.some((credential) => credential.id === credentialId);
  if (!exists) {
    return fail("NOT_FOUND", "Credential not found.");
  }
  const nextState = {
    ...state,
    credentials: state.credentials.filter((credential) => credential.id !== credentialId)
  };
  await persistVaultState(nextState);
  return ok({
    credentials: sortCredentials(nextState.credentials).map(toCredentialSummary)
  });
}
async function listCredentials() {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  return ok({
    credentials: sortCredentials(state.credentials).map(toCredentialSummary)
  });
}
async function fillCredential(credentialId, tabId) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  const credential = state.credentials.find((item) => item.id === credentialId);
  if (!credential) {
    return fail("NOT_FOUND", "Credential not found.");
  }
  const site = await getSiteInfo(tabId);
  if (!site?.supported || !site.tabId) {
    return fail("UNSUPPORTED_TAB", "Active tab does not support autofill.");
  }
  if (!siteMatchesCredential(site.url, credential)) {
    return fail(
      "UNSUPPORTED_TAB",
      "Credential does not match the active site. Vault blocks cross-site filling."
    );
  }
  const password = await decryptText(
    session.key,
    credential.passwordCiphertextB64,
    credential.passwordIvB64
  );
  const response = await sendTabMessage(site.tabId, {
    type: "content.fillLoginForm",
    payload: {
      username: credential.username,
      password
    }
  }).catch(() => fail("NO_LOGIN_FORM", "No login form was found on this page."));
  if (!response.ok) {
    return response;
  }
  if (!response.data.filled) {
    return fail("NO_LOGIN_FORM", "No login form was found on this page.");
  }
  touchSession();
  return ok({ filled: true });
}
async function getCredentialSecret(credentialId) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const sensitiveError = await requireSensitiveAccess(state);
  if (sensitiveError) {
    return sensitiveError;
  }
  const credential = state.credentials.find((item) => item.id === credentialId);
  if (!credential) {
    return fail("NOT_FOUND", "Credential not found.");
  }
  const password = await decryptText(
    session.key,
    credential.passwordCiphertextB64,
    credential.passwordIvB64
  );
  return ok({ password });
}
async function listNotes() {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  return ok({
    notes: sortNotes(state.notes).map(toNoteSummary)
  });
}
async function getNoteBody(noteId) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const sensitiveError = await requireSensitiveAccess(state);
  if (sensitiveError) {
    return sensitiveError;
  }
  const note = state.notes.find((item) => item.id === noteId);
  if (!note) {
    return fail("NOT_FOUND", "Note not found.");
  }
  const body = await decryptText(session.key, note.bodyCiphertextB64, note.bodyIvB64);
  return ok({ body });
}
async function saveNote(payload) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  const validation = validateSaveNoteInput(payload);
  if (!validation.valid) {
    return fail("VALIDATION_ERROR", validation.message);
  }
  const now = Date.now();
  const existing = payload.id ? state.notes.find((note) => note.id === payload.id) : void 0;
  if (payload.id && !existing) {
    return fail("NOT_FOUND", "Note not found.");
  }
  const encrypted = await encryptText(session.key, payload.body.trim());
  const nextNote = {
    id: existing?.id ?? crypto.randomUUID(),
    title: payload.title.trim(),
    bodyCiphertextB64: encrypted.ciphertextB64,
    bodyIvB64: encrypted.ivB64,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const notes = existing ? state.notes.map((item) => item.id === existing.id ? nextNote : item) : [...state.notes, nextNote];
  const nextState = {
    ...state,
    notes: sortNotes(notes)
  };
  await persistVaultState(nextState);
  return ok({
    notes: nextState.notes.map(toNoteSummary)
  });
}
async function deleteNote(noteId) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  const exists = state.notes.some((note) => note.id === noteId);
  if (!exists) {
    return fail("NOT_FOUND", "Note not found.");
  }
  const nextState = {
    ...state,
    notes: state.notes.filter((note) => note.id !== noteId)
  };
  await persistVaultState(nextState);
  return ok({
    notes: sortNotes(nextState.notes).map(toNoteSummary)
  });
}
async function updateSettings(settings) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }
  const nextState = {
    ...state,
    settings: normalizeSettings(settings)
  };
  await persistVaultState(nextState);
  maybeExpireSession(nextState.settings);
  return ok(await getVaultStatus(nextState));
}
async function exportData() {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const sensitiveError = await requireSensitiveAccess(state, { forceReauth: true });
  if (sensitiveError) {
    return sensitiveError;
  }
  const credentials = await Promise.all(
    sortCredentials(state.credentials).map(async (credential) => ({
      id: credential.id,
      siteOrigin: credential.siteOrigin,
      siteHostname: credential.siteHostname,
      siteMatchMode: credential.siteMatchMode,
      loginUrl: credential.loginUrl,
      username: credential.username,
      password: await decryptText(
        session.key,
        credential.passwordCiphertextB64,
        credential.passwordIvB64
      ),
      label: credential.label,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt
    }))
  );
  const notes = await Promise.all(
    sortNotes(state.notes).map(async (note) => ({
      id: note.id,
      title: note.title,
      body: await decryptText(session.key, note.bodyCiphertextB64, note.bodyIvB64),
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }))
  );
  const bundle = {
    version: VAULT_VERSION,
    exportedAt: Date.now(),
    settings: normalizeSettings(state.settings),
    credentials,
    notes
  };
  return ok(bundle);
}
async function importData(bundle) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const sensitiveError = await requireSensitiveAccess(state, { forceReauth: true });
  if (sensitiveError) {
    return sensitiveError;
  }
  if (!state.meta) {
    return fail("NOT_INITIALIZED", "Vault has not been initialized.");
  }
  if (!bundle || !Array.isArray(bundle.credentials) || !Array.isArray(bundle.notes)) {
    return fail("VALIDATION_ERROR", "Import data is invalid or incomplete.");
  }
  const credentials = await Promise.all(
    bundle.credentials.map(async (credential) => {
      const encrypted = await encryptText(session.key, credential.password);
      return {
        id: credential.id,
        siteOrigin: credential.siteOrigin,
        siteHostname: credential.siteHostname,
        siteMatchMode: credential.siteMatchMode,
        loginUrl: credential.loginUrl,
        username: credential.username,
        passwordCiphertextB64: encrypted.ciphertextB64,
        passwordIvB64: encrypted.ivB64,
        label: credential.label,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt
      };
    })
  );
  const notes = await Promise.all(
    bundle.notes.map(async (note) => {
      const encrypted = await encryptText(session.key, note.body);
      return {
        id: note.id,
        title: note.title,
        bodyCiphertextB64: encrypted.ciphertextB64,
        bodyIvB64: encrypted.ivB64,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      };
    })
  );
  const nextState = {
    meta: state.meta,
    credentials: sortCredentials(credentials),
    notes: sortNotes(notes),
    settings: normalizeSettings(bundle.settings)
  };
  await persistVaultState(nextState);
  return ok(await getVaultStatus(nextState));
}
async function handleRuntimeMessage(message, sender) {
  if (!isRuntimeMessage(message)) {
    return fail("VALIDATION_ERROR", "Received an invalid message payload.");
  }
  try {
    switch (message.type) {
      case "vault.getStatus":
        return ok(await getVaultStatus());
      case "vault.captureLoginSubmission":
        return captureLoginSubmission(
          sender,
          message.payload.username,
          message.payload.password
        );
      case "vault.dismissCapturedCredential":
        return dismissCapturedCredential(message.payload.tabId ?? sender.tab?.id);
      case "vault.getCapturePrompt":
        return getCapturePrompt(
          message.payload.tabId ?? sender.tab?.id,
          message.payload.draftUsername,
          message.payload.hasDraftPassword
        );
      case "vault.savePendingCapture":
        return savePendingCapture(
          message.payload.tabId ?? sender.tab?.id,
          message.payload.siteMatchMode,
          message.payload.label
        );
      case "vault.initialize":
        return initializeVault(message.payload.masterPassword);
      case "vault.unlock":
        return unlockVault(message.payload.masterPassword);
      case "vault.lock": {
        lockSession();
        return ok(await getVaultStatus());
      }
      case "vault.reauthenticate":
        return reauthenticateVault(message.payload.masterPassword);
      case "vault.getPopupData": {
        const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
        return getPopupData(state);
      }
      case "vault.listCredentials":
        return listCredentials();
      case "vault.saveCredential":
        return saveCredential(message.payload);
      case "vault.deleteCredential":
        return deleteCredential(message.payload.credentialId);
      case "vault.fillCredential":
        return fillCredential(message.payload.credentialId, message.payload.tabId);
      case "vault.getCredentialSecret":
        return getCredentialSecret(message.payload.credentialId);
      case "vault.listNotes":
        return listNotes();
      case "vault.getNoteBody":
        return getNoteBody(message.payload.noteId);
      case "vault.saveNote":
        return saveNote(message.payload);
      case "vault.deleteNote":
        return deleteNote(message.payload.noteId);
      case "vault.updateSettings":
        return updateSettings(message.payload);
      case "vault.exportData":
        return exportData();
      case "vault.importData":
        return importData(message.payload.bundle);
      case "vault.getSyncStatus":
        return getSyncStatus();
      case "vault.connectSyncAccount":
        return connectSyncAccount(message.payload);
      case "vault.setSyncEnabled":
        return setSyncEnabled(message.payload.enabled);
      case "vault.disconnectSyncAccount":
        return disconnectSyncAccount();
      case "vault.syncNow":
        return syncNow();
      default:
        return fail("VALIDATION_ERROR", "Unsupported message type.");
    }
  } catch (error) {
    console.error("Vault background error", error);
    return fail("INTERNAL_ERROR", "Vault encountered an unexpected error.");
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleRuntimeMessage(message, _sender).then(sendResponse);
  return true;
});
if (chrome.storage.session?.setAccessLevel) {
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearCapturedCredential(tabId);
});
