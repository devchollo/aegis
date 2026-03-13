export type VaultMeta = {
  version: number;
  saltB64: string;
  kdf: "PBKDF2";
  iterations: number;
  hash: "SHA-256";
  authCheckCiphertextB64: string;
  authCheckIvB64: string;
};

export type SiteMatchMode = "origin" | "hostname";

export type VaultCredential = {
  id: string;
  siteOrigin: string;
  siteHostname: string;
  siteMatchMode: SiteMatchMode;
  loginUrl?: string;
  username: string;
  passwordCiphertextB64: string;
  passwordIvB64: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
};

export type VaultNote = {
  id: string;
  title: string;
  bodyCiphertextB64: string;
  bodyIvB64: string;
  createdAt: number;
  updatedAt: number;
};

export type VaultSettings = {
  autoLockMinutes: number;
  requireReauthForReveal: boolean;
};

export type SyncMode = "login" | "register";

export type VaultState = {
  meta?: VaultMeta;
  credentials: VaultCredential[];
  notes: VaultNote[];
  settings: VaultSettings;
};

export type CredentialSummary = Omit<
  VaultCredential,
  "passwordCiphertextB64" | "passwordIvB64"
>;

export type NoteSummary = Omit<VaultNote, "bodyCiphertextB64" | "bodyIvB64">;

export type SaveCredentialInput = {
  id?: string;
  siteOrigin: string;
  siteMatchMode: SiteMatchMode;
  loginUrl?: string;
  username: string;
  password: string;
  label?: string;
};

export type SaveNoteInput = {
  id?: string;
  title: string;
  body: string;
};

export type VaultStatus = {
  initialized: boolean;
  unlocked: boolean;
  settings: VaultSettings;
  lastActiveAt?: number;
  expiresAt?: number;
  sensitiveAuthExpiresAt?: number;
};

export type SiteInfo = {
  tabId?: number;
  url: string;
  origin: string;
  hostname: string;
  supported: boolean;
  hasLoginForm: boolean;
};

export type PopupData = {
  site: SiteInfo | null;
  matchingCredentials: CredentialSummary[];
  totalMatches: number;
  canAccessSecrets: boolean;
  capturedCredential: CapturedCredential | null;
  hasCapturedCredential: boolean;
  capturedCredentialOrigin?: string;
};

export type CapturedCredential = {
  username: string;
  password: string;
  siteOrigin: string;
  siteHostname: string;
  loginUrl?: string;
  capturedAt: number;
};

export type VaultExportCredential = {
  id: string;
  siteOrigin: string;
  siteHostname: string;
  siteMatchMode: SiteMatchMode;
  loginUrl?: string;
  username: string;
  password: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
};

export type VaultExportNote = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export type VaultExportBundle = {
  version: number;
  exportedAt: number;
  settings: VaultSettings;
  credentials: VaultExportCredential[];
  notes: VaultExportNote[];
};

export type SyncState = {
  enabled: boolean;
  serverUrl?: string;
  username?: string;
  authToken?: string;
  lastSyncedAt?: number;
  lastLocalChangeAt?: number;
  lastRemoteCheckAt?: number;
  lastSyncError?: string;
};

export type SyncStatus = {
  enabled: boolean;
  authenticated: boolean;
  serverUrl?: string;
  username?: string;
  lastSyncedAt?: number;
  lastLocalChangeAt?: number;
  lastRemoteCheckAt?: number;
  lastSyncError?: string;
};

export type SyncCredentialsInput = {
  serverUrl: string;
  username: string;
  password: string;
  mode: SyncMode;
  enableSync?: boolean;
};

export type SyncAuthResult = {
  status: SyncStatus;
  importedRemoteVault: boolean;
  remoteVaultExists: boolean;
};

export type SyncVaultDocument = {
  state: VaultState;
  updatedAt: number;
};

export type ApiErrorCode =
  | "ALREADY_INITIALIZED"
  | "INVALID_PASSWORD"
  | "NOT_INITIALIZED"
  | "REAUTH_REQUIRED"
  | "UNSUPPORTED_TAB"
  | "NO_LOGIN_FORM"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "VAULT_LOCKED"
  | "INTERNAL_ERROR";

export type ApiError = {
  code: ApiErrorCode;
  message: string;
};

export type ApiResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: ApiError;
    };

export type SessionState = {
  key: CryptoKey | null;
  unlockedAt: number;
  lastActiveAt: number;
  sensitiveAuthAt: number;
};

export type PersistedSessionState = {
  rawKeyB64: string;
  unlockedAt: number;
  lastActiveAt: number;
  sensitiveAuthAt: number;
};

export type CapturePromptData = {
  initialized: boolean;
  unlocked: boolean;
  prompt: InlinePrompt | null;
  capture: CapturedCredential | null;
};

export type InlinePrompt =
  | {
      kind: "save";
      siteOrigin: string;
      username: string;
      loginUrl?: string;
      source: "draft" | "capture";
    }
  | {
      kind: "fill";
      siteOrigin: string;
      credentialId: string;
      username: string;
      label?: string;
      matchReason: "typed-username" | "single-match";
    };
