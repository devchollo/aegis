import type {
  SyncCredentialsInput,
  SyncVaultDocument,
  VaultState
} from "./types";
import { normalizeSyncServerUrl } from "./validators";

type SyncAuthResponse = {
  token: string;
};

async function request<T>(
  serverUrl: string,
  path: string,
  init: RequestInit,
  authToken?: string
) {
  const response = await fetch(`${normalizeSyncServerUrl(serverUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => (typeof body?.error === "string" ? body.error : null))
      .catch(() => null);

    throw new Error(message ?? `Sync request failed with ${response.status}.`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export async function authenticateSyncAccount(input: SyncCredentialsInput) {
  const endpoint = input.mode === "register" ? "/api/auth/register" : "/api/auth/login";
  return request<SyncAuthResponse>(
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

export async function fetchRemoteVault(serverUrl: string, authToken: string) {
  return request<{ vault: SyncVaultDocument | null }>(
    serverUrl,
    "/api/vault",
    { method: "GET" },
    authToken
  );
}

export async function uploadRemoteVault(
  serverUrl: string,
  authToken: string,
  state: VaultState
) {
  return request<{ updatedAt: number }>(
    serverUrl,
    "/api/vault",
    {
      method: "PUT",
      body: JSON.stringify({ state })
    },
    authToken
  );
}
