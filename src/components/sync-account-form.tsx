import { Cloud, LogIn, PencilLine, UserPlus } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import type { SyncCredentialsInput, SyncMode } from "@/shared/types";
import { validateSyncCredentials } from "@/shared/validators";

import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

type SyncAccountFormProps = {
  busy: boolean;
  error: string | null;
  defaultServerUrl?: string;
  defaultMode?: SyncMode;
  submitLabel?: string;
  onSubmit: (payload: SyncCredentialsInput) => Promise<void>;
};

export function SyncAccountForm({
  busy,
  error,
  defaultServerUrl = "",
  defaultMode = "login",
  submitLabel,
  onSubmit
}: SyncAccountFormProps) {
  const [mode, setMode] = useState<SyncMode>(defaultMode);
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [editingServerUrl, setEditingServerUrl] = useState(!defaultServerUrl);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setServerUrl(defaultServerUrl);
    setEditingServerUrl(!defaultServerUrl);
  }, [defaultServerUrl]);

  const buttonLabel = useMemo(() => {
    if (submitLabel) {
      return submitLabel;
    }

    return mode === "login" ? "Sign in to sync" : "Create sync account";
  }, [mode, submitLabel]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const payload: SyncCredentialsInput = {
      serverUrl: serverUrl.trim(),
      username: username.trim(),
      password,
      mode,
      enableSync: true
    };

    const validation = validateSyncCredentials(payload);
    if (!validation.valid) {
      setLocalError(validation.message);
      return;
    }

    await onSubmit(payload);
    setPassword("");
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-3 rounded-3xl border border-primary/20 bg-primary/5 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Cloud className="h-4 w-4" />
            <span className="text-sm font-medium">Aegis Sync</span>
          </div>
          <p className="text-sm text-foreground">
            Sign in on a new device and pull down the same encrypted vault.
          </p>
          <p className="text-xs text-muted-foreground">
            Render only stores the encrypted vault blob. Passwords and note bodies remain encrypted before upload.
          </p>
        </div>

        <Tabs value={mode} onValueChange={(value) => setMode(value as SyncMode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">
              <LogIn className="h-4 w-4" />
              Sign in
            </TabsTrigger>
            <TabsTrigger value="register">
              <UserPlus className="h-4 w-4" />
              Create account
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid gap-4">
          {editingServerUrl ? (
            <div className="space-y-2">
              <Label htmlFor="sync-server-url">Sync server URL</Label>
              <Input
                id="sync-server-url"
                placeholder="https://your-aegis-sync.onrender.com"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                autoComplete="url"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-300">
                Connected Server
              </p>
              <p className="mt-1 break-all text-sm text-emerald-50">
                You are connected to server: {serverUrl}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-8 px-2 text-emerald-100 hover:bg-emerald-500/10"
                onClick={() => setEditingServerUrl(true)}
              >
                <PencilLine className="h-4 w-4" />
                Change server URL
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sync-username">Username</Label>
            <Input
              id="sync-username"
              placeholder="jane"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync-password">Account password</Label>
            <Input
              id="sync-password"
              type="password"
              placeholder={mode === "login" ? "Enter sync account password" : "Create sync account password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
        </div>
      </div>

      {localError ? <Alert variant="destructive">{localError}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Connecting..." : buttonLabel}
      </Button>
    </form>
  );
}
