import {
  LOGIN_CAPTURE_TTL_MS,
  REMOTE_SYNC_CHECK_INTERVAL_MS,
  SESSION_AUTH_KEY,
  SESSION_CAPTURE_KEY,
  SENSITIVE_AUTH_WINDOW_MS,
  VAULT_VERSION
} from "@/shared/constants";
import {
  createVaultMeta,
  decryptText,
  encryptText,
  exportSessionKey,
  importSessionKey,
  verifyVaultPassword
} from "@/shared/crypto";
import { siteMatchesCredential } from "@/shared/match";
import { isRuntimeMessage, sendTabMessage } from "@/shared/messaging";
import {
  fetchRemoteVault,
  fetchRemoteVaultMeta,
  uploadRemoteVault,
  authenticateSyncAccount
} from "@/shared/sync";
import {
  readSyncState,
  readVaultState,
  writeSyncState,
  writeVaultState
} from "@/shared/storage";
import type {
  ApiErrorCode,
  ApiResponse,
  CapturePromptData,
  CapturedCredential,
  CredentialSummary,
  InlinePrompt,
  NoteSummary,
  PersistedSessionState,
  PopupData,
  SessionState,
  SiteInfo,
  SyncAuthResult,
  SyncCredentialsInput,
  SyncState,
  SyncStatus,
  VaultCredential,
  VaultExportBundle,
  VaultExportCredential,
  VaultExportNote,
  VaultNote,
  VaultSettings,
  VaultState,
  VaultStatus
} from "@/shared/types";
import {
  isVaultState,
  normalizeSettings,
  normalizeSyncServerUrl,
  validateMasterPassword,
  validateSaveCredentialInput,
  validateSaveNoteInput,
  validateSyncCredentials
} from "@/shared/validators";

let session: SessionState | null = null;

async function readPersistedSession() {
  const raw = await chrome.storage.session.get(SESSION_AUTH_KEY);
  return raw[SESSION_AUTH_KEY] as PersistedSessionState | undefined;
}

async function writePersistedSession(next: PersistedSessionState | null) {
  if (next) {
    await chrome.storage.session.set({ [SESSION_AUTH_KEY]: next });
    return;
  }

  await chrome.storage.session.remove(SESSION_AUTH_KEY);
}

async function readPendingLoginCaptures() {
  const raw = await chrome.storage.session.get(SESSION_CAPTURE_KEY);
  const captures = raw[SESSION_CAPTURE_KEY] as Record<string, CapturedCredential> | undefined;
  return captures ?? {};
}

async function writePendingLoginCaptures(captures: Record<string, CapturedCredential>) {
  await chrome.storage.session.set({ [SESSION_CAPTURE_KEY]: captures });
}

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

function fail(code: ApiErrorCode, message: string): ApiResponse<never> {
  return {
    ok: false,
    error: { code, message }
  };
}

function toSyncStatus(sync: SyncState): SyncStatus {
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

async function updateSyncState(mutator: (current: SyncState) => SyncState | Promise<SyncState>) {
  const current = await readSyncState();
  const next = await mutator(current);
  await writeSyncState(next);
  return next;
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

async function maybeSyncVaultState(state: VaultState) {
  const sync = await readSyncState();
  const changedAt = Date.now();

  if (!sync.enabled || !sync.serverUrl || !sync.authToken) {
    await writeSyncState({
      ...sync,
      lastLocalChangeAt: changedAt
    });
    return { ok: false as const, error: "Sync is not enabled on this device." };
  }

  try {
    const response = await uploadRemoteVault(sync.serverUrl, sync.authToken, state);

    await writeSyncState({
      ...sync,
      lastLocalChangeAt: response.updatedAt,
      lastSyncedAt: response.updatedAt,
      lastRemoteCheckAt: Date.now(),
      lastSyncError: undefined
    });
    return { ok: true as const, updatedAt: response.updatedAt };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Aegis failed to sync the encrypted vault.";

    await writeSyncState({
      ...sync,
      lastLocalChangeAt: changedAt,
      lastSyncError: message
    });
    return { ok: false as const, error: message };
  }
}

async function persistVaultState(state: VaultState, options: { sync?: boolean } = {}) {
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

async function maybeRefreshVaultFromRemote(options: { force?: boolean } = {}) {
  const sync = await readSyncState();

  if (!sync.enabled || !sync.serverUrl || !sync.authToken) {
    return { refreshed: false, state: await readVaultState() };
  }

  const now = Date.now();
  if (
    !options.force &&
    sync.lastRemoteCheckAt &&
    now - sync.lastRemoteCheckAt < REMOTE_SYNC_CHECK_INTERVAL_MS
  ) {
    return { refreshed: false, state: await readVaultState() };
  }

  const localState = await readVaultState();

  try {
    const remoteMeta = await fetchRemoteVaultMeta(sync.serverUrl, sync.authToken);
    const remoteUpdatedAt = remoteMeta.vault?.updatedAt;

    const hasUnsyncedLocalChanges =
      typeof sync.lastLocalChangeAt === "number" &&
      typeof sync.lastSyncedAt === "number" &&
      sync.lastLocalChangeAt > sync.lastSyncedAt;

    const shouldFetchFullRemote =
      typeof remoteUpdatedAt === "number" &&
      (
        !localState.meta ||
        isVaultContentEmpty(localState) ||
        ((sync.lastSyncedAt === undefined || remoteUpdatedAt > sync.lastSyncedAt) &&
          !hasUnsyncedLocalChanges)
      );

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
          lastSyncError: undefined
        });
        return { refreshed: true, state: remoteState };
      }
    }

    if (!remoteUpdatedAt && (localState.meta || !isVaultContentEmpty(localState))) {
      await writeSyncState({
        ...sync,
        lastRemoteCheckAt: now,
        lastSyncError: undefined
      });
      return { refreshed: false, state: localState };
    }

    await writeSyncState({
      ...sync,
      lastRemoteCheckAt: now,
      lastSyncError: undefined
    });
    return { refreshed: false, state: localState };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Aegis failed to refresh from the sync backend.";

    await writeSyncState({
      ...sync,
      lastRemoteCheckAt: now,
      lastSyncError: message
    });
    return { refreshed: false, state: localState };
  }
}

function toCredentialSummary(credential: VaultCredential): CredentialSummary {
  const { passwordCiphertextB64, passwordIvB64, ...summary } = credential;
  return summary;
}

function toNoteSummary(note: VaultNote): NoteSummary {
  const { bodyCiphertextB64, bodyIvB64, ...summary } = note;
  return summary;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function sortCredentials(credentials: VaultCredential[]) {
  return [...credentials].sort((left, right) => right.updatedAt - left.updatedAt);
}

function sortNotes(notes: VaultNote[]) {
  return [...notes].sort((left, right) => right.updatedAt - left.updatedAt);
}

function isVaultContentEmpty(state: VaultState) {
  return state.credentials.length === 0 && state.notes.length === 0;
}

async function getCapturedCredentialForSite(site: SiteInfo | null) {
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

function getMatchingCredentialsForSite(
  state: VaultState,
  site: SiteInfo | null
) {
  if (!site?.supported) {
    return [];
  }

  return sortCredentials(state.credentials).filter((credential) =>
    siteMatchesCredential(site.url, credential)
  );
}

function resolveInlinePrompt(options: {
  site: SiteInfo | null;
  matchingCredentials: VaultCredential[];
  capture: CapturedCredential | null;
  draftUsername?: string;
  hasDraftPassword?: boolean;
}): InlinePrompt | null {
  const { site, matchingCredentials, capture, draftUsername, hasDraftPassword } = options;

  if (!site?.supported || !site.hasLoginForm) {
    return null;
  }

  const normalizedDraftUsername = draftUsername ? normalizeUsername(draftUsername) : "";
  const exactUsernameMatch = normalizedDraftUsername
    ? matchingCredentials.find(
        (credential) => normalizeUsername(credential.username) === normalizedDraftUsername
      )
    : undefined;

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

async function clearCapturedCredential(tabId?: number) {
  if (typeof tabId === "number") {
    const captures = await readPendingLoginCaptures();
    delete captures[String(tabId)];
    await writePendingLoginCaptures(captures);
  }
}

function isExpired(settings: VaultSettings) {
  if (!session) {
    return true;
  }

  return Date.now() >= session.lastActiveAt + settings.autoLockMinutes * 60_000;
}

function maybeExpireSession(settings: VaultSettings) {
  if (session && isExpired(settings)) {
    lockSession();
  }
}

async function ensureSessionLoaded(state?: VaultState) {
  if (session?.key) {
    maybeExpireSession(normalizeSettings((state ?? (await readVaultState())).settings));
    return session;
  }

  const persisted = await readPersistedSession();
  if (!persisted) {
    return null;
  }

  const currentState = state ?? (await readVaultState());
  const settings = normalizeSettings(currentState.settings);

  if (Date.now() >= persisted.lastActiveAt + settings.autoLockMinutes * 60_000) {
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

async function getVaultStatus(state?: VaultState): Promise<VaultStatus> {
  const currentState: VaultState =
    state ?? (await maybeRefreshVaultFromRemote().then((result) => result.state));
  const settings = normalizeSettings(currentState.settings);

  await ensureSessionLoaded(currentState);
  maybeExpireSession(settings);

  return {
    initialized: Boolean(currentState.meta),
    unlocked: Boolean(session?.key),
    settings,
    lastActiveAt: session?.lastActiveAt,
    expiresAt: session ? session.lastActiveAt + settings.autoLockMinutes * 60_000 : undefined,
    sensitiveAuthExpiresAt: session
      ? session.sensitiveAuthAt + SENSITIVE_AUTH_WINDOW_MS
      : undefined
  };
}

async function requireUnlocked(state: VaultState) {
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

async function requireSensitiveAccess(
  state: VaultState,
  options: { forceReauth?: boolean } = {}
) {
  const unlockedError = await requireUnlocked(state);
  if (unlockedError) {
    return unlockedError;
  }

  const requireFreshAuth =
    options.forceReauth ||
    normalizeSettings(state.settings).requireReauthForReveal;

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

async function getActiveTab(tabId?: number) {
  if (typeof tabId === "number") {
    return chrome.tabs.get(tabId);
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function getSiteInfo(tabId?: number): Promise<SiteInfo | null> {
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

async function getPopupData(state: VaultState): Promise<ApiResponse<PopupData>> {
  const refreshedState = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const site = await getSiteInfo();
  await ensureSessionLoaded(refreshedState);
  const siteMatches = getMatchingCredentialsForSite(refreshedState, site);
  const totalMatches = siteMatches.length;
  const pendingCapture = await getCapturedCredentialForSite(site);
  const liveDraft =
    !pendingCapture && site?.supported && site.tabId
      ? await sendTabMessage(site.tabId, {
          type: "content.getLoginDraft"
        })
          .then((response) => {
            if (
              response.ok &&
              response.data.hasDraft &&
              response.data.username &&
              response.data.password
            ) {
              return {
                username: response.data.username,
                password: response.data.password,
                siteOrigin: site.origin,
                siteHostname: site.hostname,
                loginUrl: site.url,
                capturedAt: Date.now()
              } satisfies CapturedCredential;
            }

            return null;
          })
          .catch(() => null)
      : null;
  const saveCandidate = pendingCapture ?? liveDraft;
  const hasExistingDraftMatch =
    saveCandidate &&
    siteMatches.some(
      (credential) =>
        normalizeUsername(credential.username) === normalizeUsername(saveCandidate.username)
    );
  const capturedCredential = session?.key ? saveCandidate : null;

  return ok({
    site,
    matchingCredentials:
      site && site.supported && session?.key ? siteMatches.map(toCredentialSummary) : [],
    totalMatches,
    canAccessSecrets: Boolean(session?.key),
    capturedCredential: hasExistingDraftMatch ? null : capturedCredential,
    hasCapturedCredential: Boolean(saveCandidate) && !hasExistingDraftMatch,
    capturedCredentialOrigin: saveCandidate?.siteOrigin
  });
}

async function captureLoginSubmission(
  sender: chrome.runtime.MessageSender,
  username: string,
  password: string
) {
  if (!sender.tab?.id || !sender.tab.url) {
    return fail("VALIDATION_ERROR", "Login captures must originate from a tab context.");
  }

  let parsedUrl: URL;
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

async function dismissCapturedCredential(tabId?: number) {
  const tab = await getActiveTab(tabId).catch(() => undefined);
  if (!tab?.id) {
    return ok({ dismissed: false });
  }

  await clearCapturedCredential(tab.id);
  return ok({ dismissed: true });
}

async function getCapturePrompt(
  tabId?: number,
  draftUsername?: string,
  hasDraftPassword?: boolean
): Promise<ApiResponse<CapturePromptData>> {
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

async function connectSyncAccount(payload: SyncCredentialsInput): Promise<ApiResponse<SyncAuthResult>> {
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
      lastSyncError: undefined
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
        lastSyncError: undefined
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

async function setSyncEnabled(enabled: boolean) {
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

  const state = await maybeRefreshVaultFromRemote({ force: true }).then((result) => result.state);
  if (!state.meta) {
    return fail("NOT_INITIALIZED", "Initialize or import a vault before syncing.");
  }

  const result = await maybeSyncVaultState(state);
  if (!result.ok) {
    return fail("INTERNAL_ERROR", result.error);
  }

  return ok(toSyncStatus(await readSyncState()));
}

async function savePendingCapture(
  tabId?: number,
  siteMatchMode: "origin" | "hostname" = "origin",
  label?: string
) {
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
    label: label?.trim() || undefined
  });

  if (!response.ok) {
    return response;
  }

  const savedCredential = response.data.credentials.find(
    (credential) =>
      credential.siteOrigin === capture.siteOrigin &&
      credential.username === capture.username
  );

  return ok({
    saved: true,
    credentialId: savedCredential?.id ?? ""
  });
}

async function initializeVault(masterPassword: string) {
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
  const nextState: VaultState = {
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

async function unlockVault(masterPassword: string) {
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

async function reauthenticateVault(masterPassword: string) {
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

async function saveCredential(payload: Parameters<typeof validateSaveCredentialInput>[0]) {
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
  const existing = payload.id
    ? state.credentials.find((credential) => credential.id === payload.id)
    : undefined;

  if (payload.id && !existing) {
    return fail("NOT_FOUND", "Credential not found.");
  }

  let passwordCiphertextB64 = existing?.passwordCiphertextB64 ?? "";
  let passwordIvB64 = existing?.passwordIvB64 ?? "";

  if (payload.password) {
    const encrypted = await encryptText(session!.key!, payload.password);
    passwordCiphertextB64 = encrypted.ciphertextB64;
    passwordIvB64 = encrypted.ivB64;
  }

  if (!passwordCiphertextB64 || !passwordIvB64) {
    return fail("VALIDATION_ERROR", "Password is required.");
  }

  const credential: VaultCredential = {
    id: existing?.id ?? crypto.randomUUID(),
    siteOrigin: parsedOrigin.origin,
    siteHostname: parsedOrigin.hostname,
    siteMatchMode: payload.siteMatchMode,
    loginUrl: payload.loginUrl?.trim() || undefined,
    username: payload.username.trim(),
    passwordCiphertextB64,
    passwordIvB64,
    label: payload.label?.trim() || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  const credentials = existing
    ? state.credentials.map((item) => (item.id === existing.id ? credential : item))
    : [...state.credentials, credential];

  const nextState = {
    ...state,
    credentials: sortCredentials(credentials)
  };

  await persistVaultState(nextState);

  const captures = await readPendingLoginCaptures();
  let changed = false;

  for (const [tabId, capture] of Object.entries(captures)) {
    if (
      capture.siteOrigin === credential.siteOrigin &&
      capture.username === credential.username
    ) {
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

async function deleteCredential(credentialId: string) {
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

async function fillCredential(credentialId: string, tabId?: number) {
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
    session!.key!,
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

async function getCredentialSecret(credentialId: string) {
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
    session!.key!,
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

async function getNoteBody(noteId: string) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const sensitiveError = await requireSensitiveAccess(state);
  if (sensitiveError) {
    return sensitiveError;
  }

  const note = state.notes.find((item) => item.id === noteId);
  if (!note) {
    return fail("NOT_FOUND", "Note not found.");
  }

  const body = await decryptText(session!.key!, note.bodyCiphertextB64, note.bodyIvB64);

  return ok({ body });
}

async function saveNote(payload: Parameters<typeof validateSaveNoteInput>[0]) {
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
  const existing = payload.id ? state.notes.find((note) => note.id === payload.id) : undefined;

  if (payload.id && !existing) {
    return fail("NOT_FOUND", "Note not found.");
  }

  const encrypted = await encryptText(session!.key!, payload.body.trim());
  const nextNote: VaultNote = {
    id: existing?.id ?? crypto.randomUUID(),
    title: payload.title.trim(),
    bodyCiphertextB64: encrypted.ciphertextB64,
    bodyIvB64: encrypted.ivB64,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  const notes = existing
    ? state.notes.map((item) => (item.id === existing.id ? nextNote : item))
    : [...state.notes, nextNote];

  const nextState = {
    ...state,
    notes: sortNotes(notes)
  };

  await persistVaultState(nextState);

  return ok({
    notes: nextState.notes.map(toNoteSummary)
  });
}

async function deleteNote(noteId: string) {
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

async function updateSettings(settings: VaultSettings) {
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

  const credentials: VaultExportCredential[] = await Promise.all(
    sortCredentials(state.credentials).map(async (credential) => ({
      id: credential.id,
      siteOrigin: credential.siteOrigin,
      siteHostname: credential.siteHostname,
      siteMatchMode: credential.siteMatchMode,
      loginUrl: credential.loginUrl,
      username: credential.username,
      password: await decryptText(
        session!.key!,
        credential.passwordCiphertextB64,
        credential.passwordIvB64
      ),
      label: credential.label,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt
    }))
  );

  const notes: VaultExportNote[] = await Promise.all(
    sortNotes(state.notes).map(async (note) => ({
      id: note.id,
      title: note.title,
      body: await decryptText(session!.key!, note.bodyCiphertextB64, note.bodyIvB64),
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }))
  );

  const bundle: VaultExportBundle = {
    version: VAULT_VERSION,
    exportedAt: Date.now(),
    settings: normalizeSettings(state.settings),
    credentials,
    notes
  };

  return ok(bundle);
}

async function importData(bundle: VaultExportBundle) {
  const state = await maybeRefreshVaultFromRemote().then((result) => result.state);
  const sensitiveError = await requireSensitiveAccess(state, { forceReauth: true });
  if (sensitiveError) {
    return sensitiveError;
  }

  if (!state.meta) {
    return fail("NOT_INITIALIZED", "Vault has not been initialized.");
  }

  if (
    !bundle ||
    !Array.isArray(bundle.credentials) ||
    !Array.isArray(bundle.notes)
  ) {
    return fail("VALIDATION_ERROR", "Import data is invalid or incomplete.");
  }

  const credentials: VaultCredential[] = await Promise.all(
    bundle.credentials.map(async (credential) => {
      const encrypted = await encryptText(session!.key!, credential.password);

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

  const notes: VaultNote[] = await Promise.all(
    bundle.notes.map(async (note) => {
      const encrypted = await encryptText(session!.key!, note.body);

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

  const nextState: VaultState = {
    meta: state.meta,
    credentials: sortCredentials(credentials),
    notes: sortNotes(notes),
    settings: normalizeSettings(bundle.settings)
  };

  await persistVaultState(nextState);

  return ok(await getVaultStatus(nextState));
}

async function handleRuntimeMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender
): Promise<ApiResponse<unknown>> {
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
