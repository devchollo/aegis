import { type FormEvent, useState } from "react";

import { sendRuntimeMessage } from "@/shared/messaging";

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

type ReauthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => Promise<void> | void;
};

export function ReauthDialog({ open, onOpenChange, onSuccess }: ReauthDialogProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await sendRuntimeMessage({
      type: "vault.reauthenticate",
      payload: { masterPassword: password }
    });

    setBusy(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setPassword("");
    onOpenChange(false);
    await onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Re-authentication required</DialogTitle>
          <DialogDescription>
            Confirm your master password before revealing secrets or exporting data.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4 pt-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="reauth-password">Master password</Label>
            <Input
              id="reauth-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? <Alert variant="destructive">{error}</Alert> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Verifying..." : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
