import { isContentMessage, sendRuntimeMessage } from "@/shared/messaging";
import type { ApiErrorCode, ApiResponse } from "@/shared/types";

type LoginFields = {
  username?: HTMLInputElement;
  password: HTMLInputElement;
};

let lastCapturedFingerprint = "";
let lastCapturedAt = 0;
let promptRoot: HTMLDivElement | null = null;
let promptVisible = false;
let dismissedPromptKey = "";

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

function fail(code: ApiErrorCode, message: string): ApiResponse<never> {
  return { ok: false, error: { code, message } };
}

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    !element.hasAttribute("disabled") &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function scoreUsernameField(input: HTMLInputElement) {
  const autocomplete = input.autocomplete?.toLowerCase() ?? "";
  const name = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute("aria-label") ?? ""}`.toLowerCase();

  let score = 0;
  if (autocomplete.includes("username") || autocomplete.includes("email")) {
    score += 8;
  }
  if (input.type === "email") {
    score += 6;
  }
  if (/(user|email|login|identifier|account)/.test(name)) {
    score += 5;
  }
  if (input.type === "text" || input.type === "search" || input.type === "tel" || input.type === "url") {
    score += 2;
  }
  return score;
}

function scorePasswordField(input: HTMLInputElement) {
  const autocomplete = input.autocomplete?.toLowerCase() ?? "";
  const name = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute("aria-label") ?? ""}`.toLowerCase();

  let score = 0;
  if (autocomplete.includes("current-password")) {
    score += 10;
  }
  if (autocomplete.includes("new-password")) {
    score -= 4;
  }
  if (/confirm|repeat|new/.test(name)) {
    score -= 2;
  }
  return score;
}

function scoreScope(scope: ParentNode) {
  const form = scope instanceof HTMLFormElement ? scope : null;
  const text = [
    window.location.pathname,
    window.location.hostname,
    form?.action ?? "",
    form?.getAttribute("aria-label") ?? "",
    form?.innerText ?? ""
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  if (/(login|log in|sign in|signin|account|password|auth)/.test(text)) {
    score += 8;
  }
  return score;
}

function getRelevantInputs(scope: ParentNode) {
  return Array.from(scope.querySelectorAll("input")).filter(
    (input): input is HTMLInputElement => input instanceof HTMLInputElement && isVisible(input)
  );
}

function findLoginFields(): LoginFields | null {
  const forms = Array.from(document.forms);
  const scopes: ParentNode[] = forms.length ? forms : [document];
  let bestCandidate: { fields: LoginFields; score: number } | null = null;

  for (const scope of scopes) {
    const inputs = getRelevantInputs(scope);
    const passwordCandidates = inputs
      .filter((input) => input.type === "password")
      .sort((left, right) => scorePasswordField(right) - scorePasswordField(left));

    for (const password of passwordCandidates) {
      const usernameCandidates = inputs
        .filter((input) => input !== password && input.type !== "password")
        .map((input) => ({ input, score: scoreUsernameField(input) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);

      const username = usernameCandidates[0]?.input;
      const score =
        20 +
        scorePasswordField(password) +
        (usernameCandidates[0]?.score ?? 0) +
        scoreScope(scope);

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = {
          fields: {
            username,
            password
          },
          score
        };
      }
    }
  }

  return bestCandidate?.fields ?? null;
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const descriptor =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ??
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");

  descriptor?.set?.call(input, value);
  input.value = value;
}

function dispatchFieldEvents(input: HTMLInputElement) {
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

function fillLoginForm(username: string, password: string) {
  const fields = findLoginFields();
  if (!fields) {
    return false;
  }

  if (fields.username) {
    fields.username.focus();
    setNativeValue(fields.username, username);
    dispatchFieldEvents(fields.username);
  }

  fields.password.focus();
  setNativeValue(fields.password, password);
  dispatchFieldEvents(fields.password);

  return true;
}

function getLoginDraft() {
  const fields = findLoginFields();
  if (!fields) {
    return { hasDraft: false } as const;
  }

  const username = fields.username?.value.trim() ?? "";
  const password = fields.password.value ?? "";

  if (!username || !password) {
    return { hasDraft: false } as const;
  }

  return {
    hasDraft: true,
    username,
    password
  } as const;
}

function getCurrentDraftFingerprint() {
  const draft = getLoginDraft();
  if (!draft.hasDraft || !draft.username || !draft.password) {
    return "";
  }

  return `${window.location.origin}|${draft.username}|${draft.password}`;
}

function getPromptKey(prompt: {
  kind: "save" | "fill";
  username: string;
  siteOrigin: string;
  credentialId?: string;
}) {
  return prompt.kind === "fill"
    ? `fill|${prompt.siteOrigin}|${prompt.credentialId ?? prompt.username}`
    : `save|${prompt.siteOrigin}|${prompt.username}`;
}

async function captureSubmittedCredential(form: HTMLFormElement) {
  const scopedFields = findLoginFieldsInForm(form) ?? findLoginFields();
  await captureCredentialFields(scopedFields);
  await refreshCapturePrompt();
}

async function captureCredentialFields(scopedFields: LoginFields | null) {
  if (!scopedFields) {
    return;
  }

  const username = scopedFields.username?.value.trim() ?? "";
  const password = scopedFields.password.value;

  if (!username || !password) {
    return;
  }

  const fingerprint = `${window.location.origin}|${username}|${password}`;
  const now = Date.now();
  if (lastCapturedFingerprint === fingerprint && now - lastCapturedAt < 15_000) {
    return;
  }

  lastCapturedFingerprint = fingerprint;
  lastCapturedAt = now;

  await sendRuntimeMessage({
    type: "vault.captureLoginSubmission",
    payload: {
      username,
      password
    }
  }).catch(() => undefined);
}

function ensurePromptRoot() {
  if (promptRoot) {
    return promptRoot;
  }

  promptRoot = document.createElement("div");
  promptRoot.id = "aegis-save-prompt";
  promptRoot.style.position = "fixed";
  promptRoot.style.right = "20px";
  promptRoot.style.bottom = "20px";
  promptRoot.style.zIndex = "2147483647";
  promptRoot.style.maxWidth = "360px";
  promptRoot.style.fontFamily =
    "Bahnschrift, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
  document.documentElement.appendChild(promptRoot);
  return promptRoot;
}

function hideCapturePrompt() {
  if (promptRoot) {
    promptRoot.innerHTML = "";
  }
  promptVisible = false;
}

function renderCapturePrompt(options: {
  unlocked: boolean;
  kind: "save" | "fill";
  username: string;
  siteOrigin: string;
  actionLabel?: string;
  description: string;
  onPrimaryAction: () => void;
  onDismiss: () => void;
  onUnlock: () => void;
}) {
  const root = ensurePromptRoot();
  promptVisible = true;

  root.innerHTML = `
    <div style="background: rgba(15, 23, 42, 0.96); color: #f8fafc; border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 18px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.28); padding: 16px; backdrop-filter: blur(16px);">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">
        <img src="${chrome.runtime.getURL("aegis-logo.png")}" alt="Aegis" style="width:40px; height:40px; border-radius:12px; object-fit:cover; border:1px solid rgba(148,163,184,0.24);" />
        <div>
          <div style="font-size:14px; font-weight:700;">${options.kind === "fill" ? "Fill with Aegis?" : "Save login to Aegis?"}</div>
          <div style="font-size:12px; color:#cbd5e1;">${options.siteOrigin}</div>
        </div>
      </div>
      <div style="font-size:13px; color:#e2e8f0; margin-bottom:14px;">
        ${options.description}
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button type="button" data-aegis-action="dismiss" style="border:1px solid rgba(148,163,184,0.25); background:transparent; color:#e2e8f0; border-radius:12px; padding:8px 12px; cursor:pointer;">Dismiss</button>
        <button type="button" data-aegis-action="${options.unlocked ? "primary" : "unlock"}" style="border:none; background:#14b8a6; color:#062a26; font-weight:700; border-radius:12px; padding:8px 12px; cursor:pointer;">
          ${options.unlocked ? options.actionLabel ?? (options.kind === "fill" ? "Fill" : "Save") : "Unlock Aegis"}
        </button>
      </div>
    </div>
  `;

  const dismissButton = root.querySelector<HTMLButtonElement>('[data-aegis-action="dismiss"]');
  const primaryButton = root.querySelector<HTMLButtonElement>('[data-aegis-action="primary"]');
  const unlockButton = root.querySelector<HTMLButtonElement>('[data-aegis-action="unlock"]');

  dismissButton?.addEventListener("click", options.onDismiss, { once: true });
  primaryButton?.addEventListener("click", options.onPrimaryAction, { once: true });
  unlockButton?.addEventListener("click", options.onUnlock, { once: true });
}

function escapeHtml(value: string) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

async function refreshCapturePrompt() {
  const localDraft = getLoginDraft();
  const response = await sendRuntimeMessage({
    type: "vault.getCapturePrompt",
    payload: {
      draftUsername: localDraft.hasDraft ? localDraft.username : undefined,
      hasDraftPassword: localDraft.hasDraft
    }
  }).catch(() => null);

  if (!response?.ok || !response.data.prompt) {
    hideCapturePrompt();
    return;
  }

  const { prompt, capture, unlocked } = response.data;
  const promptKey = getPromptKey(prompt);
  if (dismissedPromptKey === promptKey) {
    hideCapturePrompt();
    return;
  }

  const activeCapture =
    prompt.kind === "save" && localDraft.hasDraft && localDraft.username && localDraft.password
      ? {
          username: localDraft.username,
          password: localDraft.password,
          siteOrigin: window.location.origin,
          siteHostname: window.location.hostname,
          loginUrl: window.location.href,
          capturedAt: Date.now()
        }
      : capture;

  const description =
    prompt.kind === "fill"
      ? unlocked
        ? `Use Aegis to fill <strong>${escapeHtml(prompt.username)}</strong> on this login page.`
        : `A saved login for <strong>${escapeHtml(prompt.username)}</strong> is available. Unlock Aegis to fill it.`
      : unlocked
        ? `Detected credentials for <strong>${escapeHtml(prompt.username)}</strong>. Save them to Aegis if this login is trusted.`
        : `Detected credentials for <strong>${escapeHtml(prompt.username)}</strong>. Unlock Aegis to save them.`;

  renderCapturePrompt({
    unlocked,
    kind: prompt.kind,
    username: prompt.username,
    siteOrigin: prompt.siteOrigin,
    actionLabel: prompt.kind === "fill" ? "Fill" : "Save",
    description,
    onDismiss: () => {
      dismissedPromptKey = promptKey;
      const dismissRequest =
        prompt.kind === "save" || capture
          ? sendRuntimeMessage({
              type: "vault.dismissCapturedCredential",
              payload: {}
            }).catch(() => undefined)
          : Promise.resolve(undefined);

      void dismissRequest.finally(() => hideCapturePrompt());
    },
    onPrimaryAction: () => {
      const primaryRequest =
        prompt.kind === "fill"
          ? sendRuntimeMessage({
              type: "vault.fillCredential",
              payload: {
                credentialId: prompt.credentialId
              }
            })
          : activeCapture
            ? sendRuntimeMessage({
                type: "vault.saveCredential",
                payload: {
                  siteOrigin: activeCapture.siteOrigin,
                  siteMatchMode: "origin",
                  loginUrl: activeCapture.loginUrl,
                  username: activeCapture.username,
                  password: activeCapture.password
                }
              })
            : sendRuntimeMessage({
                type: "vault.savePendingCapture",
                payload: {
                  siteMatchMode: "origin"
                }
              });

      void primaryRequest.then((actionResponse) => {
        if (actionResponse?.ok) {
          dismissedPromptKey = promptKey;
          void sendRuntimeMessage({
            type: "vault.dismissCapturedCredential",
            payload: {}
          }).catch(() => undefined);
          hideCapturePrompt();
          return;
        }

        if (actionResponse?.error.code === "VAULT_LOCKED") {
          void sendRuntimeMessage({ type: "vault.openPopup" }).catch(() => undefined);
          return;
        }

        if (promptRoot) {
          const message = document.createElement("div");
          message.textContent =
            actionResponse?.error.message ??
            (prompt.kind === "fill" ? "Failed to fill login." : "Failed to save login.");
          message.style.marginTop = "10px";
          message.style.fontSize = "12px";
          message.style.color = "#fca5a5";
          promptRoot.firstElementChild?.appendChild(message);
        }
      });
    },
    onUnlock: () => {
      void sendRuntimeMessage({ type: "vault.openPopup" }).catch(() => undefined);
    }
  });
}

function findLoginFieldsInForm(form: HTMLFormElement) {
  const inputs = getRelevantInputs(form);
  const passwordCandidates = inputs
    .filter((input) => input.type === "password")
    .sort((left, right) => scorePasswordField(right) - scorePasswordField(left));

  const password = passwordCandidates[0];
  if (!password) {
    return null;
  }

  const username = inputs
    .filter((input) => input !== password && input.type !== "password")
    .map((input) => ({ input, score: scoreUsernameField(input) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.input;

  return {
    username,
    password
  };
}

function getRelatedForm(target: EventTarget | null) {
  if (target instanceof HTMLFormElement) {
    return target;
  }

  if (
    target instanceof HTMLButtonElement ||
    target instanceof HTMLInputElement
  ) {
    return target.form;
  }

  if (target instanceof HTMLElement) {
    const button = target.closest("button,input[type=submit],input[type=button]");
    if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) {
      return button.form;
    }
  }

  return null;
}

function scheduleCapture(form: HTMLFormElement | null | undefined) {
  window.setTimeout(() => {
    if (form) {
      void captureSubmittedCredential(form);
      return;
    }

    void captureCredentialFields(findLoginFields()).then(() => refreshCapturePrompt());
  }, 0);
}

async function handleMessage(message: unknown): Promise<ApiResponse<unknown>> {
  if (!isContentMessage(message)) {
    return fail("VALIDATION_ERROR", "Invalid content message payload.");
  }

  switch (message.type) {
    case "content.scanLoginForm":
      return ok({ hasLoginForm: Boolean(findLoginFields()) });
    case "content.getLoginDraft":
      return ok(getLoginDraft());
    case "content.fillLoginForm":
      return ok({
        filled: fillLoginForm(message.payload.username, message.payload.password)
      });
    default:
      return fail("VALIDATION_ERROR", "Unsupported content message.");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true;
});

void refreshCapturePrompt();

document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden || promptVisible) {
      void refreshCapturePrompt();
    }
  },
  true
);

document.addEventListener(
  "input",
  (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      (target.type === "password" ||
        target.type === "email" ||
        target.type === "text" ||
        target.autocomplete?.includes("username") ||
        target.autocomplete?.includes("current-password"))
    ) {
      const currentFingerprint = getCurrentDraftFingerprint();
      if (currentFingerprint) {
        dismissedPromptKey = "";
      }
      void refreshCapturePrompt();
    }
  },
  true
);

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement) {
      void captureSubmittedCredential(form);
    }
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    const form = getRelatedForm(event.target);
    scheduleCapture(form);
  },
  true
);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Enter") {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      (target.type === "password" || target.type === "email" || target.type === "text")
    ) {
      scheduleCapture(target.form);
    }
  },
  true
);
