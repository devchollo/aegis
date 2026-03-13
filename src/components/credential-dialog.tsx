import { RefreshCw, WandSparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { generatePassword } from "@/lib/password";
import { getMatchModeLabel } from "@/shared/match";
import type {
  CredentialSummary,
  SaveCredentialInput,
  SiteInfo,
  SiteMatchMode
} from "@/shared/types";
import { validateSaveCredentialInput } from "@/shared/validators";

import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type CredentialDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCredential?: CredentialSummary | null;
  site?: SiteInfo | null;
  draft?: Partial<SaveCredentialInput> | null;
  busy: boolean;
  onSave: (payload: SaveCredentialInput) => Promise<void>;
};

type FormState = {
  id?: string;
  siteOrigin: string;
  siteMatchMode: SiteMatchMode;
  loginUrl: string;
  username: string;
  password: string;
  label: string;
};

function FieldLabel({
  htmlFor,
  text,
  required
}: {
  htmlFor: string;
  text: string;
  required: boolean;
}) {
  return (
    <Label htmlFor={htmlFor} className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <span>{text}</span>
      <span className="text-xs font-normal text-muted-foreground">
        {required ? "Required" : "Optional"}
      </span>
    </Label>
  );
}

function createInitialState(
  credential?: CredentialSummary | null,
  site?: SiteInfo | null,
  draft?: Partial<SaveCredentialInput> | null
): FormState {
  return {
    id: credential?.id,
    siteOrigin: credential?.siteOrigin ?? draft?.siteOrigin ?? site?.origin ?? "",
    siteMatchMode: credential?.siteMatchMode ?? draft?.siteMatchMode ?? "origin",
    loginUrl: credential?.loginUrl ?? draft?.loginUrl ?? "",
    username: credential?.username ?? draft?.username ?? "",
    password: draft?.password ?? "",
    label: credential?.label ?? draft?.label ?? ""
  };
}

export function CredentialDialog({
  open,
  onOpenChange,
  initialCredential,
  site,
  draft,
  busy,
  onSave
}: CredentialDialogProps) {
  const [form, setForm] = useState<FormState>(createInitialState(initialCredential, site, draft));
  const [error, setError] = useState<string | null>(null);
  const passwordRequired = !initialCredential;

  useEffect(() => {
    if (open) {
      setForm(createInitialState(initialCredential, site, draft));
      setError(null);
    }
  }, [open, initialCredential, site, draft]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload: SaveCredentialInput = {
      id: form.id,
      siteOrigin: form.siteOrigin.trim(),
      siteMatchMode: form.siteMatchMode,
      loginUrl: form.loginUrl.trim() || undefined,
      username: form.username.trim(),
      password: form.password,
      label: form.label.trim() || undefined
    };

    const validation = validateSaveCredentialInput(payload);
    if (!validation.valid) {
      setError(validation.message);
      return;
    }

    setError(null);
    await onSave(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initialCredential ? "Edit credential" : "Save credential"}</DialogTitle>
          <DialogDescription>
            Passwords are encrypted individually with AES-GCM before they touch storage.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4 pt-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <FieldLabel htmlFor="credential-origin" text="Site origin" required />
              <Input
                id="credential-origin"
                placeholder="https://example.com"
                value={form.siteOrigin}
                onChange={(event) =>
                  setForm((current) => ({ ...current, siteOrigin: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="credential-match-mode" text="Match mode" required />
              <select
                id="credential-match-mode"
                className="flex h-10 w-full rounded-xl border border-input bg-card/70 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.siteMatchMode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    siteMatchMode: event.target.value as SiteMatchMode
                  }))
                }
              >
                <option value="origin">{getMatchModeLabel("origin")}</option>
                <option value="hostname">{getMatchModeLabel("hostname")}</option>
              </select>
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="credential-login-url" text="Login URL" required={false} />
              <Input
                id="credential-login-url"
                placeholder="https://example.com/login"
                value={form.loginUrl}
                onChange={(event) =>
                  setForm((current) => ({ ...current, loginUrl: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="credential-label" text="Label" required={false} />
              <Input
                id="credential-label"
                placeholder="Work account"
                value={form.label}
                onChange={(event) =>
                  setForm((current) => ({ ...current, label: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="credential-username" text="Username or email" required />
              <Input
                id="credential-username"
                placeholder="name@example.com"
                value={form.username}
                onChange={(event) =>
                  setForm((current) => ({ ...current, username: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <FieldLabel
                  htmlFor="credential-password"
                  text="Password"
                  required={passwordRequired}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      password: generatePassword()
                    }))
                  }
                >
                  <WandSparkles className="h-4 w-4" />
                  Generate
                </Button>
              </div>
              <Input
                id="credential-password"
                type="password"
                placeholder={initialCredential ? "Leave empty to keep existing password" : "Enter password"}
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
              />
            </div>
          </div>

          {error ? <Alert variant="destructive">{error}</Alert> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : initialCredential ? (
                "Save changes"
              ) : (
                "Save credential"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
