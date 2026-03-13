import { SyncAccountForm } from "@/components/sync-account-form";
import type { SyncCredentialsInput } from "@/shared/types";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";

type SyncAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: string | null;
  defaultServerUrl?: string;
  onSubmit: (payload: SyncCredentialsInput) => Promise<void>;
};

export function SyncAccountDialog({
  open,
  onOpenChange,
  busy,
  error,
  defaultServerUrl,
  onSubmit
}: SyncAccountDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Aegis Sync</DialogTitle>
          <DialogDescription>
            Authenticate to your Render-hosted sync service before Aegis uploads the encrypted vault.
          </DialogDescription>
        </DialogHeader>

        <div className="pt-4">
          <SyncAccountForm
            busy={busy}
            error={error}
            defaultServerUrl={defaultServerUrl}
            onSubmit={onSubmit}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
