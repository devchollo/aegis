import type {
  ApiResponse,
  CapturePromptData,
  CredentialSummary,
  PopupData,
  SaveCredentialInput,
  SaveNoteInput,
  SyncAuthResult,
  SyncCredentialsInput,
  SyncStatus,
  VaultExportBundle,
  VaultSettings,
  VaultStatus
} from "./types";
import { isSiteMatchMode, isVaultExportBundle } from "./validators";

export interface RuntimeMessageMap {
  "vault.getStatus": {
    request: { type: "vault.getStatus" };
    response: VaultStatus;
  };
  "vault.initialize": {
    request: { type: "vault.initialize"; payload: { masterPassword: string } };
    response: VaultStatus;
  };
  "vault.unlock": {
    request: { type: "vault.unlock"; payload: { masterPassword: string } };
    response: VaultStatus;
  };
  "vault.lock": {
    request: { type: "vault.lock" };
    response: VaultStatus;
  };
  "vault.reauthenticate": {
    request: { type: "vault.reauthenticate"; payload: { masterPassword: string } };
    response: VaultStatus;
  };
  "vault.getPopupData": {
    request: { type: "vault.getPopupData" };
    response: PopupData;
  };
  "vault.captureLoginSubmission": {
    request: {
      type: "vault.captureLoginSubmission";
      payload: { username: string; password: string };
    };
    response: { captured: boolean };
  };
  "vault.dismissCapturedCredential": {
    request: { type: "vault.dismissCapturedCredential"; payload: { tabId?: number } };
    response: { dismissed: boolean };
  };
  "vault.getCapturePrompt": {
    request: {
      type: "vault.getCapturePrompt";
      payload: { tabId?: number; draftUsername?: string; hasDraftPassword?: boolean };
    };
    response: CapturePromptData;
  };
  "vault.savePendingCapture": {
    request: {
      type: "vault.savePendingCapture";
      payload: { tabId?: number; siteMatchMode?: "origin" | "hostname"; label?: string };
    };
    response: { saved: boolean; credentialId: string };
  };
  "vault.listCredentials": {
    request: { type: "vault.listCredentials" };
    response: { credentials: CredentialSummary[] };
  };
  "vault.saveCredential": {
    request: { type: "vault.saveCredential"; payload: SaveCredentialInput };
    response: { credentials: CredentialSummary[] };
  };
  "vault.deleteCredential": {
    request: { type: "vault.deleteCredential"; payload: { credentialId: string } };
    response: { credentials: CredentialSummary[] };
  };
  "vault.fillCredential": {
    request: { type: "vault.fillCredential"; payload: { credentialId: string; tabId?: number } };
    response: { filled: boolean };
  };
  "vault.getCredentialSecret": {
    request: { type: "vault.getCredentialSecret"; payload: { credentialId: string } };
    response: { password: string };
  };
  "vault.listNotes": {
    request: { type: "vault.listNotes" };
    response: {
      notes: Array<{
        id: string;
        title: string;
        createdAt: number;
        updatedAt: number;
      }>;
    };
  };
  "vault.getNoteBody": {
    request: { type: "vault.getNoteBody"; payload: { noteId: string } };
    response: { body: string };
  };
  "vault.saveNote": {
    request: { type: "vault.saveNote"; payload: SaveNoteInput };
    response: {
      notes: Array<{
        id: string;
        title: string;
        createdAt: number;
        updatedAt: number;
      }>;
    };
  };
  "vault.deleteNote": {
    request: { type: "vault.deleteNote"; payload: { noteId: string } };
    response: {
      notes: Array<{
        id: string;
        title: string;
        createdAt: number;
        updatedAt: number;
      }>;
    };
  };
  "vault.updateSettings": {
    request: { type: "vault.updateSettings"; payload: VaultSettings };
    response: VaultStatus;
  };
  "vault.exportData": {
    request: { type: "vault.exportData" };
    response: VaultExportBundle;
  };
  "vault.importData": {
    request: { type: "vault.importData"; payload: { bundle: VaultExportBundle } };
    response: VaultStatus;
  };
  "vault.getSyncStatus": {
    request: { type: "vault.getSyncStatus" };
    response: SyncStatus;
  };
  "vault.connectSyncAccount": {
    request: { type: "vault.connectSyncAccount"; payload: SyncCredentialsInput };
    response: SyncAuthResult;
  };
  "vault.setSyncEnabled": {
    request: { type: "vault.setSyncEnabled"; payload: { enabled: boolean } };
    response: SyncStatus;
  };
  "vault.disconnectSyncAccount": {
    request: { type: "vault.disconnectSyncAccount" };
    response: SyncStatus;
  };
  "vault.syncNow": {
    request: { type: "vault.syncNow" };
    response: SyncStatus;
  };
}

export interface ContentMessageMap {
  "content.scanLoginForm": {
    request: { type: "content.scanLoginForm" };
    response: { hasLoginForm: boolean };
  };
  "content.getLoginDraft": {
    request: { type: "content.getLoginDraft" };
    response: {
      hasDraft: boolean;
      username?: string;
      password?: string;
    };
  };
  "content.fillLoginForm": {
    request: {
      type: "content.fillLoginForm";
      payload: { username: string; password: string };
    };
    response: { filled: boolean };
  };
}

export type RuntimeMessageType = keyof RuntimeMessageMap;
export type RuntimeMessage = RuntimeMessageMap[RuntimeMessageType]["request"];
export type RuntimeResponse<T extends RuntimeMessageType> = ApiResponse<
  RuntimeMessageMap[T]["response"]
>;

export type ContentMessageType = keyof ContentMessageMap;
export type ContentMessage = ContentMessageMap[ContentMessageType]["request"];
export type ContentResponse<T extends ContentMessageType> = ApiResponse<
  ContentMessageMap[T]["response"]
>;

export async function sendRuntimeMessage<T extends RuntimeMessage>(
  message: T
) {
  return chrome.runtime.sendMessage(message) as Promise<
    RuntimeResponse<T["type"]>
  >;
}

export async function sendTabMessage<T extends ContentMessage>(
  tabId: number,
  message: T
) {
  return chrome.tabs.sendMessage(tabId, message) as Promise<
    ContentResponse<T["type"]>
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
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
      return (
        isRecord(value.payload) &&
        hasString(value.payload.username) &&
        hasString(value.payload.password)
      );
    case "vault.dismissCapturedCredential":
      return (
        isRecord(value.payload) &&
        (value.payload.tabId === undefined || typeof value.payload.tabId === "number")
      );
    case "vault.getCapturePrompt":
      return (
        isRecord(value.payload) &&
        (value.payload.tabId === undefined || typeof value.payload.tabId === "number") &&
        (value.payload.draftUsername === undefined || typeof value.payload.draftUsername === "string") &&
        (value.payload.hasDraftPassword === undefined ||
          typeof value.payload.hasDraftPassword === "boolean")
      );
    case "vault.savePendingCapture":
      return (
        isRecord(value.payload) &&
        (value.payload.tabId === undefined || typeof value.payload.tabId === "number") &&
        (value.payload.siteMatchMode === undefined || isSiteMatchMode(value.payload.siteMatchMode)) &&
        (value.payload.label === undefined || typeof value.payload.label === "string")
      );
    case "vault.initialize":
    case "vault.unlock":
    case "vault.reauthenticate":
      return (
        isRecord(value.payload) && typeof value.payload.masterPassword === "string"
      );
    case "vault.saveCredential":
      return (
        isRecord(value.payload) &&
        hasString(value.payload.siteOrigin) &&
        hasString(value.payload.username) &&
        typeof value.payload.password === "string" &&
        isSiteMatchMode(value.payload.siteMatchMode) &&
        (value.payload.id === undefined || typeof value.payload.id === "string") &&
        (value.payload.loginUrl === undefined || typeof value.payload.loginUrl === "string") &&
        (value.payload.label === undefined || typeof value.payload.label === "string")
      );
    case "vault.deleteCredential":
    case "vault.getCredentialSecret":
      return isRecord(value.payload) && hasString(value.payload.credentialId);
    case "vault.fillCredential":
      return (
        isRecord(value.payload) &&
        hasString(value.payload.credentialId) &&
        (value.payload.tabId === undefined || typeof value.payload.tabId === "number")
      );
    case "vault.getNoteBody":
    case "vault.deleteNote":
      return isRecord(value.payload) && hasString(value.payload.noteId);
    case "vault.saveNote":
      return (
        isRecord(value.payload) &&
        hasString(value.payload.title) &&
        hasString(value.payload.body) &&
        (value.payload.id === undefined || typeof value.payload.id === "string")
      );
    case "vault.updateSettings":
      return (
        isRecord(value.payload) &&
        typeof value.payload.autoLockMinutes === "number" &&
        typeof value.payload.requireReauthForReveal === "boolean"
      );
    case "vault.importData":
      return isRecord(value.payload) && isVaultExportBundle(value.payload.bundle);
    case "vault.connectSyncAccount":
      return (
        isRecord(value.payload) &&
        typeof value.payload.serverUrl === "string" &&
        typeof value.payload.username === "string" &&
        typeof value.payload.password === "string" &&
        (value.payload.mode === "login" || value.payload.mode === "register") &&
        (value.payload.enableSync === undefined ||
          typeof value.payload.enableSync === "boolean")
      );
    case "vault.setSyncEnabled":
      return isRecord(value.payload) && typeof value.payload.enabled === "boolean";
    default:
      return false;
  }
}

export function isContentMessage(value: unknown): value is ContentMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "content.scanLoginForm":
    case "content.getLoginDraft":
      return true;
    case "content.fillLoginForm":
      return (
        isRecord(value.payload) &&
        typeof value.payload.username === "string" &&
        typeof value.payload.password === "string"
      );
    default:
      return false;
  }
}
