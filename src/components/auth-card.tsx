import { Fingerprint, LockKeyhole, ShieldCheck } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { SyncAccountForm } from "@/components/sync-account-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SyncCredentialsInput } from "@/shared/types";

type AuthCardProps = {
  mode: "setup" | "unlock";
  busy: boolean;
  error: string | null;
  notice?: string | null;
  compact?: boolean;
  hintTitle?: string;
  hintDescription?: string;
  syncAuthBusy?: boolean;
  syncAuthError?: string | null;
  defaultSyncServerUrl?: string;
  syncConnectedUsername?: string;
  onSyncAuth?: (payload: SyncCredentialsInput) => Promise<void>;
  onStartFreshLocalVault?: () => Promise<void>;
  onSubmit: (password: string) => Promise<void>;
};

export function AuthCard({
  mode,
  busy,
  error,
  notice = null,
  compact = false,
  hintTitle,
  hintDescription,
  syncAuthBusy = false,
  syncAuthError = null,
  defaultSyncServerUrl,
  syncConnectedUsername,
  onSyncAuth,
  onStartFreshLocalVault,
  onSubmit
}: AuthCardProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const title = mode === "setup" ? "Create your Aegis vault" : "Unlock Aegis";
  const description =
    mode === "setup"
      ? "Create a master password. It derives your encryption key locally and is never stored."
      : "Enter your master password to decrypt secrets for this session.";

  const helper = useMemo(() => {
    if (mode === "setup") {
      return "Use at least 10 characters. Longer is materially better.";
    }

    return "Aegis locks again after browser restart, service worker unload, or manual lock.";
  }, [mode]);

  const logoUrl = chrome.runtime.getURL("aegis-logo.png");
  const syncSectionTitle =
    mode === "setup"
      ? "Synced and already have an account?"
      : "Need to pull your synced vault first?";
  const syncSectionDescription =
    mode === "setup"
      ? "Sign in to Aegis Sync on this device, then unlock the downloaded vault with your master password."
      : "Sign in to Aegis Sync before unlocking if this browser has not pulled your latest encrypted vault yet.";
  const showFreshLocalVaultAction =
    mode === "unlock" && !defaultSyncServerUrl && Boolean(onStartFreshLocalVault);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    if (mode === "setup") {
      if (password.trim().length < 10) {
        setLocalError("Use at least 10 characters for the master password.");
        return;
      }

      if (password !== confirmPassword) {
        setLocalError("Passwords do not match.");
        return;
      }
    }

    await onSubmit(password);

    if (mode === "setup") {
      setConfirmPassword("");
    }
    setPassword("");
  }

  return (
    <div
      className={[
        "mx-auto flex w-full items-center",
        compact ? "min-h-[560px] max-w-[420px] p-3" : "min-h-screen max-w-lg p-4"
      ].join(" ")}
    >
      <Card className="w-full overflow-hidden">
        <CardHeader className="space-y-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={logoUrl}
                alt="Aegis logo"
                className="h-12 w-12 rounded-2xl border border-border bg-card/80 object-cover p-1"
              />
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                {mode === "setup" ? (
                  <ShieldCheck className="h-6 w-6" />
                ) : (
                  <LockKeyhole className="h-6 w-6" />
                )}
              </div>
            </div>
            <div className="rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
              Local-only encryption
            </div>
          </div>
          <div className="space-y-1">
            <CardTitle className="vault-heading text-2xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {onSyncAuth ? (
            <div className="space-y-4 pb-6">
              {syncConnectedUsername && defaultSyncServerUrl ? (
                <Alert>
                  <div className="space-y-1">
                    <p className="font-medium">Sync connected</p>
                    <p className="text-sm">
                      Signed in as {syncConnectedUsername} on {defaultSyncServerUrl}.
                    </p>
                  </div>
                </Alert>
              ) : null}
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{syncSectionTitle}</p>
                <p className="text-sm text-muted-foreground">
                  {syncSectionDescription}
                </p>
              </div>
              <SyncAccountForm
                busy={syncAuthBusy}
                error={syncAuthError}
                defaultServerUrl={defaultSyncServerUrl}
                onSubmit={onSyncAuth}
              />
              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {mode === "setup" ? "Or create local vault" : "Or unlock local vault"}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="master-password">Master password</Label>
              <Input
                id="master-password"
                type="password"
                autoFocus
                autoComplete={mode === "setup" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter master password"
              />
            </div>

            {mode === "setup" ? (
              <div className="space-y-2">
                <Label htmlFor="confirm-master-password">Confirm password</Label>
                <Input
                  id="confirm-master-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter master password"
                />
              </div>
            ) : null}

            <div className="rounded-2xl bg-secondary/70 p-3 text-sm text-muted-foreground">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Fingerprint className="h-4 w-4 text-primary" />
                <span className="font-medium">Security model</span>
              </div>
              <p>{helper}</p>
            </div>

            {hintTitle ? (
              <Alert>
                <div className="space-y-1">
                  <p className="font-medium">{hintTitle}</p>
                  {hintDescription ? <p className="text-sm">{hintDescription}</p> : null}
                </div>
              </Alert>
            ) : null}

            {localError ? <Alert variant="destructive">{localError}</Alert> : null}
            {notice ? <Alert>{notice}</Alert> : null}
            {error ? <Alert variant="destructive">{error}</Alert> : null}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Working..." : mode === "setup" ? "Create Aegis" : "Unlock Aegis"}
            </Button>

            {showFreshLocalVaultAction ? (
              <div className="space-y-3 rounded-2xl border border-border bg-secondary/50 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Need a brand-new local vault on this device?
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Reset the local device state and return to first-run setup. This does not delete anything on a sync server.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void onStartFreshLocalVault?.()}
                >
                  Create local vault instead
                </Button>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
