import {
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Lock,
  NotebookTabs,
  Plus,
  RefreshCcw
} from "lucide-react";
import { useEffect, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { CredentialDialog } from "@/components/credential-dialog";
import { EmptyState } from "@/components/empty-state";
import { NoteDialog } from "@/components/note-dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { getMatchModeLabel } from "@/shared/match";
import { sendRuntimeMessage } from "@/shared/messaging";
import type {
  CapturedCredential,
  CredentialSummary,
  PopupData,
  SaveCredentialInput,
  SaveNoteInput,
  VaultStatus
} from "@/shared/types";

export default function App() {
  const logoUrl = chrome.runtime.getURL("aegis-logo.png");
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [popupData, setPopupData] = useState<PopupData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [credentialDraft, setCredentialDraft] = useState<Partial<SaveCredentialInput> | null>(null);

  async function refresh() {
    const statusResponse = await sendRuntimeMessage({ type: "vault.getStatus" });
    if (!statusResponse.ok) {
      setError(statusResponse.error.message);
      return;
    }

    setStatus(statusResponse.data);

    const popupResponse = await sendRuntimeMessage({ type: "vault.getPopupData" });
    if (!popupResponse.ok) {
      setError(popupResponse.error.message);
      return;
    }

    setPopupData(popupResponse.data);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleAuth(mode: "setup" | "unlock", password: string) {
    setBusy(true);
    setError(null);

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
      setError(response.error.message);
      return;
    }

    setNotice(mode === "setup" ? "Aegis created." : "Aegis unlocked.");
    await refresh();
  }

  async function handleLock() {
    await sendRuntimeMessage({ type: "vault.lock" });
    await refresh();
  }

  async function handleSaveCredential(payload: SaveCredentialInput) {
    setBusy(true);
    setError(null);

    const response = await sendRuntimeMessage({
      type: "vault.saveCredential",
      payload
    });

    setBusy(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setCredentialDialogOpen(false);
    setCredentialDraft(null);

    if (
      popupData?.capturedCredential &&
      payload.username === popupData.capturedCredential.username &&
      payload.siteOrigin === popupData.capturedCredential.siteOrigin
    ) {
      await sendRuntimeMessage({
        type: "vault.dismissCapturedCredential",
        payload: {
          tabId: popupData.site?.tabId
        }
      });
    }

    setNotice(payload.id ? "Credential updated." : "Credential saved.");
    await refresh();
  }

  async function handleSaveNote(payload: SaveNoteInput) {
    setBusy(true);
    setError(null);

    const response = await sendRuntimeMessage({
      type: "vault.saveNote",
      payload
    });

    setBusy(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setNoteDialogOpen(false);
    setNotice(payload.id ? "Note updated." : "Note saved.");
    await refresh();
  }

  async function handleFill(credential: CredentialSummary) {
    if (!popupData?.site?.tabId) {
      setError("No active site is available for autofill.");
      return;
    }

    setBusy(true);
    setError(null);

    const response = await sendRuntimeMessage({
      type: "vault.fillCredential",
      payload: {
        credentialId: credential.id,
        tabId: popupData.site.tabId
      }
    });

    setBusy(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setNotice(`Filled ${credential.username}.`);
  }

  async function handleDismissCaptured() {
    if (!popupData?.site?.tabId) {
      return;
    }

    await sendRuntimeMessage({
      type: "vault.dismissCapturedCredential",
      payload: { tabId: popupData.site.tabId }
    });
    setNotice("Captured login dismissed.");
    await refresh();
  }

  function openCapturedCredential(capture: CapturedCredential) {
    setCredentialDraft({
      siteOrigin: capture.siteOrigin,
      siteMatchMode: "origin",
      loginUrl: capture.loginUrl,
      username: capture.username,
      password: capture.password,
      label: ""
    });
    setCredentialDialogOpen(true);
  }

  if (!status) {
    return (
      <div className="flex min-h-screen w-[390px] items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!status.initialized) {
    return (
      <div className="w-[420px]">
        <AuthCard
          mode="setup"
          compact
          busy={busy}
          error={error}
          onSubmit={(password) => handleAuth("setup", password)}
        />
      </div>
    );
  }

  if (!status.unlocked) {
    return (
      <div className="w-[420px]">
        <AuthCard
          mode="unlock"
          compact
          busy={busy}
          error={error}
          hintTitle={popupData?.hasCapturedCredential ? "Recent login captured" : undefined}
          hintDescription={
            popupData?.hasCapturedCredential
              ? `Unlock Aegis to review and save a submitted login for ${popupData.capturedCredentialOrigin ?? "this site"}.`
              : undefined
          }
          onSubmit={(password) => handleAuth("unlock", password)}
        />
      </div>
    );
  }

  return (
    <div className="w-[420px] p-3 text-foreground">
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                    <img src={logoUrl} alt="Aegis logo" className="h-5 w-5 rounded-md object-cover" />
                  </div>
                  <Badge variant="success">Unlocked</Badge>
                </div>
                <CardTitle className="vault-heading text-xl">Aegis</CardTitle>
                <CardDescription>
                  Secure local credentials and notes for the current site.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="icon" variant="outline" onClick={() => void refresh()} aria-label="Refresh popup">
                  <RefreshCcw className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="outline" onClick={() => void handleLock()} aria-label="Lock Aegis">
                  <Lock className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {notice ? <Alert>{notice}</Alert> : null}
            {error ? <Alert variant="destructive">{error}</Alert> : null}

            <div className="rounded-2xl bg-secondary/70 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">Current site</p>
                <Badge variant={popupData?.site?.hasLoginForm ? "success" : "outline"}>
                  {popupData?.site?.hasLoginForm ? "Login form detected" : "No login form"}
                </Badge>
              </div>
              {popupData?.site?.supported ? (
                <div className="space-y-1">
                  <p className="truncate text-sm font-medium">{popupData.site.origin}</p>
                  <p className="text-xs text-muted-foreground">{popupData.site.hostname}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Active tab is not an HTTP or HTTPS page, so Aegis will not fill secrets here.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => {
                  setCredentialDraft(null);
                  setCredentialDialogOpen(true);
                }}
                className="justify-start"
              >
                <Plus className="h-4 w-4" />
                Save credential
              </Button>
              <Button variant="secondary" onClick={() => setNoteDialogOpen(true)} className="justify-start">
                <NotebookTabs className="h-4 w-4" />
                Quick note
              </Button>
            </div>

            <Button
              variant="ghost"
              className="w-full justify-between"
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              Open dashboard
              <ExternalLink className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        {popupData?.capturedCredential ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Recent login detected</CardTitle>
                  <CardDescription>
                    Aegis captured a submitted credential on this site. Save it if you trust this login.
                  </CardDescription>
                </div>
                <Badge variant="warning">Review</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl bg-secondary/70 p-3">
                <p className="text-sm font-medium">{popupData.capturedCredential.username}</p>
                <p className="text-xs text-muted-foreground">
                  Captured from {popupData.capturedCredential.loginUrl ?? popupData.capturedCredential.siteOrigin}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => openCapturedCredential(popupData.capturedCredential!)}
                >
                  Save captured login
                </Button>
                <Button variant="outline" onClick={() => void handleDismissCaptured()}>
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Matching credentials</CardTitle>
                <CardDescription>
                  {popupData?.totalMatches ?? 0} item{popupData?.totalMatches === 1 ? "" : "s"} for this site
                </CardDescription>
              </div>
              <Badge variant="outline">
                {popupData?.site?.supported ? "Strict matching" : "Unavailable"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {popupData?.matchingCredentials.length ? (
              <ScrollArea className="max-h-[280px] pr-3">
                <div className="space-y-3">
                  {popupData.matchingCredentials.map((credential, index) => (
                    <div key={credential.id} className="rounded-2xl border border-border bg-card/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <KeyRound className="h-4 w-4 text-primary" />
                            <p className="truncate text-sm font-medium">
                              {credential.label || credential.username}
                            </p>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {credential.username}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {getMatchModeLabel(credential.siteMatchMode)}
                          </p>
                        </div>
                        <Button size="sm" onClick={() => void handleFill(credential)} disabled={busy}>
                          Fill
                        </Button>
                      </div>
                      {index < popupData.matchingCredentials.length - 1 ? (
                        <Separator className="mt-3" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <EmptyState
                icon={KeyRound}
                title="No saved credential for this site"
                description="Save one from the popup or use the full dashboard for broader vault management."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <CredentialDialog
        open={credentialDialogOpen}
        onOpenChange={(open) => {
          setCredentialDialogOpen(open);
          if (!open) {
            setCredentialDraft(null);
          }
        }}
        site={popupData?.site}
        draft={credentialDraft}
        busy={busy}
        onSave={handleSaveCredential}
      />

      <NoteDialog
        open={noteDialogOpen}
        onOpenChange={setNoteDialogOpen}
        busy={busy}
        onSave={handleSaveNote}
      />
    </div>
  );
}
