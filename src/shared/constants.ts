import type { VaultSettings } from "./types";

export const STORAGE_KEY = "vault-state";
export const SYNC_STORAGE_KEY = "vault-sync-state";
export const SESSION_CAPTURE_KEY = "pending-login-captures";
export const SESSION_AUTH_KEY = "vault-auth-session";
export const VAULT_VERSION = 1;
export const DEFAULT_KDF_ITERATIONS = 310_000;
export const AUTH_CHECK_VALUE = "vault-auth-check::v1";
export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 15,
  requireReauthForReveal: true
};
export const SENSITIVE_AUTH_WINDOW_MS = 5 * 60 * 1000;
export const MIN_AUTO_LOCK_MINUTES = 1;
export const MAX_AUTO_LOCK_MINUTES = 240;
export const LOGIN_CAPTURE_TTL_MS = 10 * 60 * 1000;
export const REMOTE_SYNC_CHECK_INTERVAL_MS = 15 * 1000;
