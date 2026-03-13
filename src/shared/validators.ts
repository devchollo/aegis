import {
  DEFAULT_SETTINGS,
  MAX_AUTO_LOCK_MINUTES,
  MIN_AUTO_LOCK_MINUTES
} from "./constants";
import type {
  CapturedCredential,
  SaveCredentialInput,
  SaveNoteInput,
  SiteMatchMode,
  SyncCredentialsInput,
  VaultCredential,
  VaultExportBundle,
  VaultMeta,
  VaultNote,
  VaultSettings,
  VaultState
} from "./types";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalText(value: unknown) {
  return value === undefined || typeof value === "string";
}

export function clampAutoLockMinutes(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.autoLockMinutes;
  }

  return Math.min(MAX_AUTO_LOCK_MINUTES, Math.max(MIN_AUTO_LOCK_MINUTES, Math.round(value)));
}

export function normalizeSettings(settings: Partial<VaultSettings> | undefined): VaultSettings {
  return {
    autoLockMinutes: clampAutoLockMinutes(settings?.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes),
    requireReauthForReveal:
      typeof settings?.requireReauthForReveal === "boolean"
        ? settings.requireReauthForReveal
        : DEFAULT_SETTINGS.requireReauthForReveal
  };
}

export function validateMasterPassword(password: string) {
  return password.trim().length >= 10;
}

export function normalizeSyncServerUrl(value: string) {
  const parsed = new URL(value.trim());

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Sync server must use http or https.");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString().replace(/\/$/, "");
}

export function validateSyncCredentials(
  input: SyncCredentialsInput
): { valid: true } | { valid: false; message: string } {
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

export function validateSaveCredentialInput(
  input: SaveCredentialInput
): { valid: true } | { valid: false; message: string } {
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

export function validateSaveNoteInput(
  input: SaveNoteInput
): { valid: true } | { valid: false; message: string } {
  if (!hasText(input.title)) {
    return { valid: false, message: "Note title is required." };
  }

  if (!hasText(input.body)) {
    return { valid: false, message: "Note body is required." };
  }

  return { valid: true };
}

export function isSiteMatchMode(value: unknown): value is SiteMatchMode {
  return value === "origin" || value === "hostname";
}

function isVaultMeta(value: unknown): value is VaultMeta {
  if (!value || typeof value !== "object") {
    return false;
  }

  const meta = value as VaultMeta;

  return (
    typeof meta.version === "number" &&
    hasText(meta.saltB64) &&
    meta.kdf === "PBKDF2" &&
    typeof meta.iterations === "number" &&
    meta.hash === "SHA-256" &&
    hasText(meta.authCheckCiphertextB64) &&
    hasText(meta.authCheckIvB64)
  );
}

function isVaultCredential(value: unknown): value is VaultCredential {
  if (!value || typeof value !== "object") {
    return false;
  }

  const credential = value as VaultCredential;
  return (
    hasText(credential.id) &&
    hasText(credential.siteOrigin) &&
    hasText(credential.siteHostname) &&
    isSiteMatchMode(credential.siteMatchMode) &&
    isOptionalText(credential.loginUrl) &&
    hasText(credential.username) &&
    hasText(credential.passwordCiphertextB64) &&
    hasText(credential.passwordIvB64) &&
    isOptionalText(credential.label) &&
    typeof credential.createdAt === "number" &&
    typeof credential.updatedAt === "number"
  );
}

function isVaultNote(value: unknown): value is VaultNote {
  if (!value || typeof value !== "object") {
    return false;
  }

  const note = value as VaultNote;
  return (
    hasText(note.id) &&
    hasText(note.title) &&
    hasText(note.bodyCiphertextB64) &&
    hasText(note.bodyIvB64) &&
    typeof note.createdAt === "number" &&
    typeof note.updatedAt === "number"
  );
}

export function isVaultState(value: unknown): value is VaultState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as VaultState;
  return (
    (state.meta === undefined || isVaultMeta(state.meta)) &&
    Array.isArray(state.credentials) &&
    state.credentials.every(isVaultCredential) &&
    Array.isArray(state.notes) &&
    state.notes.every(isVaultNote) &&
    typeof state.settings === "object"
  );
}

export function isVaultExportBundle(value: unknown): value is VaultExportBundle {
  if (!value || typeof value !== "object") {
    return false;
  }

  const bundle = value as VaultExportBundle;
  return (
    typeof bundle.version === "number" &&
    typeof bundle.exportedAt === "number" &&
    Array.isArray(bundle.credentials) &&
    bundle.credentials.every(
      (credential) =>
        hasText(credential.id) &&
        hasText(credential.siteOrigin) &&
        hasText(credential.siteHostname) &&
        isSiteMatchMode(credential.siteMatchMode) &&
        hasText(credential.username) &&
        hasText(credential.password) &&
        isOptionalText(credential.loginUrl) &&
        isOptionalText(credential.label) &&
        typeof credential.createdAt === "number" &&
        typeof credential.updatedAt === "number"
    ) &&
    Array.isArray(bundle.notes) &&
    bundle.notes.every(
      (note) =>
        hasText(note.id) &&
        hasText(note.title) &&
        hasText(note.body) &&
        typeof note.createdAt === "number" &&
        typeof note.updatedAt === "number"
    ) &&
    typeof bundle.settings === "object"
  );
}

export function isCapturedCredential(value: unknown): value is CapturedCredential {
  if (!value || typeof value !== "object") {
    return false;
  }

  const capture = value as CapturedCredential;
  return (
    hasText(capture.username) &&
    hasText(capture.password) &&
    hasText(capture.siteOrigin) &&
    hasText(capture.siteHostname) &&
    isOptionalText(capture.loginUrl) &&
    typeof capture.capturedAt === "number"
  );
}
