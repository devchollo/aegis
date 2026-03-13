import { RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import type { NoteSummary, SaveNoteInput } from "@/shared/types";
import { validateSaveNoteInput } from "@/shared/validators";

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
import { Textarea } from "./ui/textarea";

type NoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialNote?: NoteSummary | null;
  initialBody?: string;
  busy: boolean;
  onSave: (payload: SaveNoteInput) => Promise<void>;
};

export function NoteDialog({
  open,
  onOpenChange,
  initialNote,
  initialBody,
  busy,
  onSave
}: NoteDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(initialNote?.title ?? "");
      setBody(initialBody ?? "");
      setError(null);
    }
  }, [open, initialNote, initialBody]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: SaveNoteInput = {
      id: initialNote?.id,
      title: title.trim(),
      body: body.trim()
    };

    const validation = validateSaveNoteInput(payload);
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
          <DialogTitle>{initialNote ? "Edit secure note" : "Create secure note"}</DialogTitle>
          <DialogDescription>
            Note bodies are decrypted only on demand and never persisted in plaintext.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4 pt-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              placeholder="Recovery codes"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-body">Body</Label>
            <Textarea
              id="note-body"
              placeholder="Store high-value notes here."
              className="min-h-[220px]"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
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
              ) : initialNote ? (
                "Save note"
              ) : (
                "Create note"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
