import {
  Cloud,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileKey2,
  Import,
  KeyRound,
  LoaderCircle,
  Lock,
  NotebookPen,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { CredentialDialog } from "@/components/credential-dialog";
import { EmptyState } from "@/components/empty-state";
import { NoteDialog } from "@/components/note-dialog";
import { ReauthDialog } from "@/components/reauth-dialog";
import { SyncAccountDialog } from "@/components/sync-account-dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMatchModeLabel } from "@/shared/match";
import { sendRuntimeMessage } from "@/shared/messaging";
import type {
  CredentialSummary,
  NoteSummary,
  SaveCredentialInput,
  SaveNoteInput,
  SyncCredentialsInput,
  SyncStatus,
  VaultExportBundle,
  VaultSettings,
  VaultStatus
} from "@/shared/types";

function formatTimestamp(value?: number) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export default function App() {
  const logoUrl = chrome.runtime.getURL("aegis-logo.png");
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncAuthError, setSyncAuthError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialSearch, setCredentialSearch] = useState("");
  const [noteSearch, setNoteSearch] = useState("");
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<CredentialSummary | null>(null);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<NoteSummary | null>(null);
  const [editingNoteBody, setEditingNoteBody] = useState("");
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [settingsDraft, setSettingsDraft] = useState<VaultSettings>({
    autoLockMinutes: 15,
    requireReauthForReveal: true
  });
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<null | (() => Promise<void>)>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  async function refreshStatusAndData() {
    const [statusResponse, syncResponse] = await Promise.all([
      sendRuntimeMessage({ type: "vault.getStatus" }),
      sendRuntimeMessage({ type: "vault.getSyncStatus" })
    ]);

    if (!statusResponse.ok) {
      setPageError(statusResponse.error.message);
      return;
    }

    setStatus(statusResponse.data);
    setSettingsDraft(statusResponse.data.settings);

    if (syncResponse.ok) {
      setSyncStatus(syncResponse.data);
    } else {
      setPageError(syncResponse.error.message);
    }

    if (!statusResponse.data.unlocked) {
      setCredentials([]);
      setNotes([]);
      setRevealedPasswords({});
      return;
    }

    const [credentialsResponse, notesResponse] = await Promise.all([
      sendRuntimeMessage({ type: "vault.listCredentials" }),
      sendRuntimeMessage({ type: "vault.listNotes" })
    ]);

    if (credentialsResponse.ok) {
      setCredentials(credentialsResponse.data.credentials);
    } else {
      setPageError(credentialsResponse.error.message);
    }

    if (notesResponse.ok) {
      setNotes(notesResponse.data.notes);
    } else {
      setPageError(notesResponse.error.message);
    }
  }

  useEffect(() => {
    void refreshStatusAndData();
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        void refreshStatusAndData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    if (!syncStatus?.authenticated || !syncStatus.enabled || document.hidden) {
      return () => {
        document.removeEventListener("visibilitychange", handleVisibility);
      };
    }

    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void refreshStatusAndData();
      }
    }, 60_000);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [syncStatus?.authenticated, syncStatus?.enabled]);

  const filteredCredentials = useMemo(() => {
    const query = credentialSearch.trim().toLowerCase();
    if (!query) {
      return credentials;
    }

    return credentials.filter((credential) =>
      [credential.label, credential.username, credential.siteOrigin, credential.siteHostname]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    );
  }, [credentialSearch, credentials]);

  const filteredNotes = useMemo(() => {
    const query = noteSearch.trim().toLowerCase();
    if (!query) {
      return notes;
    }

    return notes.filter((note) => note.title.toLowerCase().includes(query));
  }, [noteSearch, notes]);

  async function handleAuth(mode: "setup" | "unlock", password: string) {
    setBusy(true);
    setAuthError(null);

    const response =
      mode === "setup"
        ? await sendRuntimeMessage({
            type: "vault.initialize",
            payload: { masterPassword: password }
          })
        : await sendRuntimeMessage({
            type: "vault.unlock",
            payload: { masterPassword: password }
          });

    setBusy(false);

    if (!response.ok) {
      setAuthError(response.error.message);
      return;
    }

    setNotice(mode === "setup" ? "Aegis created." : "Aegis unlocked.");
    await refreshStatusAndData();
  }

  async function handleSyncAuth(payload: SyncCredentialsInput) {
    setSyncBusy(true);
    setSyncAuthError(null);

    const response = await sendRuntimeMessage({
      type: "vault.connectSyncAccount",
      payload
    });

    setSyncBusy(false);

    if (!response.ok) {
      setSyncAuthError(response.error.message);
      return;
    }

    const unlockResponse = await sendRuntimeMessage({
      type: "vault.unlock",
      payload: { masterPassword: payload.password }
    });

    setSyncStatus(response.data.status);
    setSyncDialogOpen(false);

    if (unlockResponse.ok) {
      setNotice(
        response.data.importedRemoteVault
          ? "Encrypted vault downloaded and unlocked from Aegis Sync."
          : "Sync account connected and vault unlocked."
      );
    } else {
      setNotice(
        response.data.importedRemoteVault
          ? "Encrypted vault downloaded from Aegis Sync. Enter your master password to unlock it."
          : response.data.remoteVaultExists
            ? "Sync account connected. Enter your master password to unlock this vault."
            : "Sync account connected. Create or update your local vault and Aegis will upload the encrypted state."
      );
    }

    await refreshStatusAndData();
  }

  async function handleToggleSync(checked: boolean) {
    if (checked && !syncStatus?.authenticated) {
      setSyncDialogOpen(true);
      return;
    }

    const response = await sendRuntimeMessage({
      type: "vault.setSyncEnabled",
      payload: { enabled: checked }
    });

    if (!response.ok) {
      setPageError(response.error.message);
      return;
    }

    setSyncStatus(response.data);
    setNotice(checked ? "Aegis Sync enabled." : "Aegis Sync paused.");
    await refreshStatusAndData();
  }

  async function handleSyncNow() {
    const response = await sendRuntimeMessage({ type: "vault.syncNow" });

    if (!response.ok) {
      setPageError(response.error.message);
      return;
    }

    setSyncStatus(response.data);
    setNotice("Encrypted vault synced to the backend.");
  }

  async function handleDisconnectSync() {
    const response = await sendRuntimeMessage({ type: "vault.disconnectSyncAccount" });

    if (!response.ok) {
      setPageError(response.error.message);
      return;
    }

    setSyncStatus(response.data);
    setNotice("Sync account disconnected on this device.");
  }

  async function queueSensitiveAction(action: () => Promise<void>) {
    setPendingSensitiveAction(() => action);
    setReauthOpen(true);
  }

  async function handleSensitiveResponse(
    response: { ok: boolean; error?: { code: string; message: string } },
    retry: () => Promise<void>
  ) {
    if (response.ok) {
      return false;
    }

    if (response.error?.code === "REAUTH_REQUIRED") {
      await queueSensitiveAction(retry);
      return true;
    }

    setPageError(response.error?.message ?? "Aegis encountered an unexpected error.");

    if (response.error?.code === "VAULT_LOCKED") {
      await refreshStatusAndData();
    }

    return true;
  }

  async function handleSaveCredential(payload: SaveCredentialInput) {
    setBusy(true);
    setPageError(null);

    const response = await sendRuntimeMessage({
      type: "vault.saveCredential",
      payload
    });

    setBusy(false);

    if (!response.ok) {
      setPageError(response.error.message);
      return;
    }

    setCredentials(response.data.credentials);
    setCredentialDialogOpen(false);
    setEditingCredential(null);
    setNotice(payload.id ? "Credential updated." : "Credential saved.");
  }

  async function handleDeleteCredential(credentialId: string) {
    if (!window.confirm("Delete this credential?")) {
      return;
    }

    const response = await sendRuntimeMessage({
      type: "vault.deleteCredential",
      payload: { credentialId }
    });

    if (!response.ok) {
      setPageError(response.error.message);
      return;
    }

    setCredentials(response.data.credentials);
    setNotice("Credential deleted.");
  }

  async function handleRevealPassword(credentialId: string) {
    if (revealedPasswords[credentialId]) {
      setRevealedPasswords((current) => {
        const next = { ...current };
        delete next[credentialId];
        return next;
      });
      return;
    }

    const action = async () => {
      const response = await sendRuntimeMessage({
        type: "vault.getCredentialSecret",
        payload: { credentialId }
      });

      if (await handleSensitiveResponse(response, action)) {
        return;
      }

      if (response.ok) {
        setRevealedPasswords((current) => ({
          ...current,
          [credentialId]: response.data.password
        }));
      }
    };

    await action();
  }

  async function copyPassword(credentialId: string) {
    const password = revealedPasswords[credentialId];

    if (!password) {
      setPageError("Reveal the password before copying it.");
      return;
    }

    await navigator.clipboard.writeText(password);
    setNotice("Password copied to clipboard.");
  }

  async function openNoteEditor(note?: NoteSummary) {
    setPageError(null);

    if (!note) {
      setEditingNote(null);
      setEditingNoteBody("");
      setNoteDialogOpen(true);
      return;
    }

    const action = async () => {
      const response = await sendRuntimeMessage({
        type: "vault.getNoteBody",
        payload: { noteId: note.id }
      });

      if (await handleSensitiveResponse(response, action)) {
        return;
      }

      if (response.ok) {
        setEditingNote(note);
        setEditingNoteBody(response.data.body);
        setNoteDialogOpen(true);
      }
    };

    await action();
  }

  async function handleSaveNote(payload: SaveNoteInput) {
    setBusy(true);
    setPageError(null);

    const response = await sendRuntimeMessage({
      type: "vault.saveNote",
      payload
    });

    setBusy(false);

    if (!response.ok) {
      setPageError(response.error.message);
      return;
    }

    setNotes(response.data.notes);
    setEditingNote(null);
    setEditingNoteBody("");
    setNoteDialogOpen(false);
    setNotice(payload.id ? "Note updated." : "Note created.");
  }

  async function handleDeleteNote(noteId: string) {
    if (!window.confirm("Delete this note?")) {
      return;
    }

    const response = await sendRuntimeMessage({
      type: "vault.deleteNote",
      payload: { noteId }
    });

    if (!response.ok) {
      setPageError(response.error.message);
      return;
    }

    setNotes(response.data.notes);
    setNotice("Note deleted.");
  }

  async function handleSaveSettings() {
    const response = await sendRuntimeMessage({
      type: "vault.updateSettings",
      payload: settingsDraft
    });

    if (!response.ok) {
      setPageError(response.error.message);
      return;
    }

    setStatus(response.data);
    setSettingsDraft(response.data.settings);
    setNotice("Security settings updated.");
  }

  async function handleLock() {
    await sendRuntimeMessage({ type: "vault.lock" });
    setNotice("Aegis locked.");
    await refreshStatusAndData();
  }

  async function handleStartFreshLocalVault() {
    if (
      !window.confirm(
        "Reset this device and create a new local vault? This clears the local Aegis vault on this browser only and does not delete any sync backend data."
      )
    ) {
      return;
    }

    setBusy(true);
    setAuthError(null);

    const response = await sendRuntimeMessage({ type: "vault.resetLocalVault" });

    setBusy(false);

    if (!response.ok) {
      setAuthError(response.error.message);
      return;
    }

    setNotice("Local device vault cleared. Create a new local vault to continue.");
    await refreshStatusAndData();
  }

  async function handleExport() {
    await queueSensitiveAction(async () => {
      const response = await sendRuntimeMessage({ type: "vault.exportData" });

      if (response.ok) {
        const blob = new Blob([JSON.stringify(response.data, null, 2)], {
          type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `aegis-export-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        setNotice("Plaintext Aegis export downloaded.");
        return;
      }

      setPageError(response.error.message);
    });
  }

  async function handleImportBundle(bundle: VaultExportBundle) {
    const action = async () => {
      const response = await sendRuntimeMessage({
        type: "vault.importData",
        payload: { bundle }
      });

      if (await handleSensitiveResponse(response, action)) {
        return;
      }

      if (response.ok) {
        setNotice("Aegis import completed and was re-encrypted with the current master password.");
        await refreshStatusAndData();
      }
    };

    await action();
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as VaultExportBundle;

      if (!window.confirm("Importing replaces the entire current vault state. Continue?")) {
        return;
      }

      await handleImportBundle(parsed);
    } catch {
      setPageError("Selected file is not a valid Aegis export.");
    }
  }

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!status.initialized) {
    return (
      <AuthCard
        mode="setup"
        busy={busy}
        error={authError}
        syncAuthBusy={syncBusy}
        syncAuthError={syncAuthError}
        defaultSyncServerUrl={syncStatus?.serverUrl}
        onSyncAuth={handleSyncAuth}
        onSubmit={(password) => handleAuth("setup", password)}
      />
    );
  }

  if (!status.unlocked) {
    return (
      <AuthCard
        mode="unlock"
        busy={busy}
        error={authError}
        syncAuthBusy={syncBusy}
        syncAuthError={syncAuthError}
        defaultSyncServerUrl={syncStatus?.serverUrl}
        onSyncAuth={handleSyncAuth}
        onStartFreshLocalVault={handleStartFreshLocalVault}
        onSubmit={(password) => handleAuth("unlock", password)}
      />
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                    <img src={logoUrl} alt="Aegis logo" className="h-6 w-6 rounded-lg object-cover" />
                  </div>
                  <Badge variant="success">Unlocked</Badge>
                  <Badge variant="outline">Auto-lock {status.settings.autoLockMinutes}m</Badge>
                </div>
                <div>
                  <CardTitle className="vault-heading text-3xl">Aegis Dashboard</CardTitle>
                  <CardDescription>
                    Manage credentials, secure notes, and session controls without exposing plaintext at rest.
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void refreshStatusAndData()}>
                  Refresh
                </Button>
                <Button variant="outline" onClick={() => void handleExport()}>
                  <Download className="h-4 w-4" />
                  Export plaintext
                </Button>
                <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                  <Import className="h-4 w-4" />
                  Import
                </Button>
                <Button variant="destructive" onClick={() => void handleLock()}>
                  <Lock className="h-4 w-4" />
                  Lock now
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {notice ? <Alert>{notice}</Alert> : null}
            {pageError ? <Alert variant="destructive">{pageError}</Alert> : null}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-secondary/70 p-4">
                <p className="text-sm font-medium text-foreground">Credentials</p>
                <p className="mt-1 text-2xl font-semibold">{credentials.length}</p>
                <p className="text-sm text-muted-foreground">Encrypted password entries</p>
              </div>
              <div className="rounded-2xl bg-secondary/70 p-4">
                <p className="text-sm font-medium text-foreground">Secure notes</p>
                <p className="mt-1 text-2xl font-semibold">{notes.length}</p>
                <p className="text-sm text-muted-foreground">Bodies decrypted only on demand</p>
              </div>
              <div className="rounded-2xl bg-secondary/70 p-4">
                <p className="text-sm font-medium text-foreground">Session expires</p>
                <p className="mt-1 text-sm font-medium">{formatTimestamp(status.expiresAt)}</p>
                <p className="text-sm text-muted-foreground">
                  Sensitive auth: {formatTimestamp(status.sensitiveAuthExpiresAt)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="credentials">
          <TabsList>
            <TabsTrigger value="credentials">Credentials</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="credentials">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-xl">Credential Vault</CardTitle>
                    <CardDescription>
                      Search, edit, reveal, and prune stored website credentials.
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => {
                      setEditingCredential(null);
                      setCredentialDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add credential
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search by site, label, or username"
                    value={credentialSearch}
                    onChange={(event) => setCredentialSearch(event.target.value)}
                  />
                </div>

                {filteredCredentials.length ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filteredCredentials.map((credential) => {
                      const revealed = revealedPasswords[credential.id];

                      return (
                        <Card key={credential.id} className="overflow-hidden">
                          <CardContent className="space-y-4 p-5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <KeyRound className="h-4 w-4 text-primary" />
                                  <p className="font-medium">{credential.label || credential.username}</p>
                                </div>
                                <p className="text-sm text-muted-foreground">{credential.username}</p>
                                <p className="text-xs text-muted-foreground">{credential.siteOrigin}</p>
                              </div>
                              <Badge variant="outline">
                                {getMatchModeLabel(credential.siteMatchMode)}
                              </Badge>
                            </div>

                            <div className="rounded-2xl bg-secondary/70 p-3">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                Password
                              </p>
                              <p className="mt-1 font-mono text-sm">
                                {revealed ? revealed : "****************"}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleRevealPassword(credential.id)}
                              >
                                {revealed ? (
                                  <>
                                    <EyeOff className="h-4 w-4" />
                                    Hide
                                  </>
                                ) : (
                                  <>
                                    <Eye className="h-4 w-4" />
                                    Reveal
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void copyPassword(credential.id)}
                                disabled={!revealed}
                              >
                                <Copy className="h-4 w-4" />
                                Copy
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setEditingCredential(credential);
                                  setCredentialDialogOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                                onClick={() => void handleDeleteCredential(credential.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </Button>
                            </div>

                            <Separator />

                            <div className="text-xs text-muted-foreground">
                              Updated {formatTimestamp(credential.updatedAt)}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={FileKey2}
                    title="No matching credentials"
                    description="Add a credential or adjust the search filter."
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-xl">Secure Notes</CardTitle>
                    <CardDescription>
                      Search, decrypt on demand, and edit private note content.
                    </CardDescription>
                  </div>
                  <Button onClick={() => void openNoteEditor()}>
                    <Plus className="h-4 w-4" />
                    Add note
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search note titles"
                    value={noteSearch}
                    onChange={(event) => setNoteSearch(event.target.value)}
                  />
                </div>

                {filteredNotes.length ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filteredNotes.map((note) => (
                      <Card key={note.id}>
                        <CardContent className="space-y-4 p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <NotebookPen className="h-4 w-4 text-primary" />
                                <p className="font-medium">{note.title}</p>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                Updated {formatTimestamp(note.updatedAt)}
                              </p>
                            </div>
                            <Badge variant="secondary">Encrypted</Badge>
                          </div>
                          <div className="rounded-2xl bg-secondary/70 p-3 text-sm text-muted-foreground">
                            Bodies stay encrypted in storage and decrypt only after an authenticated request.
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => void openNoteEditor(note)}>
                              Open
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => void handleDeleteNote(note.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={NotebookPen}
                    title="No notes found"
                    description="Create a secure note or adjust the current search."
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security">
            <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Security Settings</CardTitle>
                  <CardDescription>
                    Control session timeout and when Aegis prompts for fresh authentication.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="auto-lock">Auto-lock timeout (minutes)</Label>
                    <Input
                      id="auto-lock"
                      type="number"
                      min={1}
                      max={240}
                      value={settingsDraft.autoLockMinutes}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          autoLockMinutes: Number(event.target.value)
                        }))
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Session state lives in memory only. A background worker unload also drops the key.
                    </p>
                  </div>

                  <div className="flex items-start justify-between gap-4 rounded-2xl bg-secondary/70 p-4">
                    <div className="space-y-1">
                      <Label htmlFor="reauth-required">Require re-authentication for reveals</Label>
                      <p className="text-sm text-muted-foreground">
                        Revealing passwords, opening decrypted note bodies, and exports can require a fresh password check.
                      </p>
                    </div>
                    <Switch
                      id="reauth-required"
                      checked={settingsDraft.requireReauthForReveal}
                      onCheckedChange={(checked) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          requireReauthForReveal: checked
                        }))
                      }
                    />
                  </div>

                  <Button onClick={() => void handleSaveSettings()}>
                    <Save className="h-4 w-4" />
                    Save settings
                  </Button>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">Aegis Sync</CardTitle>
                    <CardDescription>
                      Authenticate once, then sync the already-encrypted vault blob to your Render backend across devices.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start justify-between gap-4 rounded-2xl bg-secondary/70 p-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-foreground">
                          <Cloud className="h-4 w-4 text-primary" />
                          <span className="font-medium">Encrypted sync</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Aegis uploads the encrypted vault state, not decrypted passwords or note bodies.
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(syncStatus?.enabled)}
                        onCheckedChange={(checked) => void handleToggleSync(checked)}
                      />
                    </div>

                    <div className="rounded-2xl bg-secondary/70 p-4 text-sm text-muted-foreground">
                      <p>
                        Account: {syncStatus?.username ?? "Not connected"}
                      </p>
                      <p>
                        Server: {syncStatus?.serverUrl ?? "Not configured"}
                      </p>
                      <p>
                        Last sync: {formatTimestamp(syncStatus?.lastSyncedAt)}
                      </p>
                      <p>
                        Status: {syncStatus?.authenticated ? "Authenticated" : "Disconnected"}
                      </p>
                    </div>

                    {syncStatus?.lastSyncError ? (
                      <Alert variant="destructive">{syncStatus.lastSyncError}</Alert>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant={syncStatus?.authenticated ? "outline" : "default"}
                        onClick={() => setSyncDialogOpen(true)}
                      >
                        {syncStatus?.authenticated ? "Change account" : "Connect sync account"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleSyncNow()}
                        disabled={!syncStatus?.authenticated || !syncStatus?.enabled}
                      >
                        Sync now
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => void handleDisconnectSync()}
                        disabled={!syncStatus?.authenticated}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">Backup and Recovery</CardTitle>
                    <CardDescription>
                      Export plaintext secrets after a password prompt, or import an Aegis backup and re-encrypt it with the current master password.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-2xl bg-secondary/70 p-4 text-sm text-muted-foreground">
                      Export files contain decrypted credentials and decrypted note bodies. Treat them like raw secrets and store them carefully.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => void handleExport()}>
                        <Download className="h-4 w-4" />
                        Export plaintext Aegis
                      </Button>
                      <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                        <Import className="h-4 w-4" />
                        Import Aegis
                      </Button>
                    </div>

                    <Separator />

                    <div className="rounded-2xl bg-secondary/70 p-4">
                      <div className="mb-2 flex items-center gap-2 text-foreground">
                        <Settings2 className="h-4 w-4 text-primary" />
                        <span className="font-medium">Current session</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Last activity: {formatTimestamp(status.lastActiveAt)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        General session expiry: {formatTimestamp(status.expiresAt)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Sensitive auth expiry: {formatTimestamp(status.sensitiveAuthExpiresAt)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <CredentialDialog
        open={credentialDialogOpen}
        onOpenChange={(open) => {
          setCredentialDialogOpen(open);
          if (!open) {
            setEditingCredential(null);
          }
        }}
        initialCredential={editingCredential}
        busy={busy}
        onSave={handleSaveCredential}
      />

      <NoteDialog
        open={noteDialogOpen}
        onOpenChange={(open) => {
          setNoteDialogOpen(open);
          if (!open) {
            setEditingNote(null);
            setEditingNoteBody("");
          }
        }}
        initialNote={editingNote}
        initialBody={editingNoteBody}
        busy={busy}
        onSave={handleSaveNote}
      />

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={async () => {
          if (pendingSensitiveAction) {
            const action = pendingSensitiveAction;
            setPendingSensitiveAction(null);
            await action();
          }

          await refreshStatusAndData();
        }}
      />

      <SyncAccountDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        busy={syncBusy}
        error={syncAuthError}
        defaultServerUrl={syncStatus?.serverUrl}
        onSubmit={handleSyncAuth}
      />

      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => void handleImportFile(event)}
      />
    </div>
  );
}
