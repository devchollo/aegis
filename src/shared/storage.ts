import { DEFAULT_SETTINGS, STORAGE_KEY, SYNC_STORAGE_KEY } from "./constants";
import type { SyncState, VaultState } from "./types";

function cloneDefaultState(): VaultState {
  return {
    credentials: [],
    notes: [],
    settings: { ...DEFAULT_SETTINGS }
  };
}

export function createEmptyVaultState(
  overrides?: Partial<Pick<VaultState, "settings">>
): VaultState {
  return {
    credentials: [],
    notes: [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...(overrides?.settings ?? {})
    }
  };
}

export async function readVaultState(): Promise<VaultState> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const state = raw[STORAGE_KEY] as Partial<VaultState> | undefined;

  if (!state) {
    return cloneDefaultState();
  }

  return {
    meta: state.meta,
    credentials: Array.isArray(state.credentials) ? state.credentials : [],
    notes: Array.isArray(state.notes) ? state.notes : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...(state.settings ?? {})
    }
  };
}

export async function writeVaultState(state: VaultState) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function readSyncState(): Promise<SyncState> {
  const raw = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  const state = raw[SYNC_STORAGE_KEY] as Partial<SyncState> | undefined;

  if (!state) {
    return { enabled: false };
  }

  return {
    enabled: Boolean(state.enabled),
    serverUrl: typeof state.serverUrl === "string" ? state.serverUrl : undefined,
    username: typeof state.username === "string" ? state.username : undefined,
    authToken: typeof state.authToken === "string" ? state.authToken : undefined,
    lastSyncedAt: typeof state.lastSyncedAt === "number" ? state.lastSyncedAt : undefined,
    lastLocalChangeAt:
      typeof state.lastLocalChangeAt === "number" ? state.lastLocalChangeAt : undefined,
    lastRemoteCheckAt:
      typeof state.lastRemoteCheckAt === "number" ? state.lastRemoteCheckAt : undefined,
    lastSyncError: typeof state.lastSyncError === "string" ? state.lastSyncError : undefined
  };
}

export async function writeSyncState(state: SyncState) {
  await chrome.storage.local.set({ [SYNC_STORAGE_KEY]: state });
}
