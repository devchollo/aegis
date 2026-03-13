import type { CredentialSummary, SiteMatchMode } from "./types";

export function normalizeOrigin(input: string) {
  const parsed = new URL(input);
  return parsed.origin;
}

export function normalizeHostname(input: string) {
  const parsed = new URL(input);
  return parsed.hostname;
}

export function isSupportedSiteUrl(input: string) {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function siteMatchesCredential(
  siteUrl: string,
  credential: Pick<CredentialSummary, "siteOrigin" | "siteHostname" | "siteMatchMode">
) {
  if (!isSupportedSiteUrl(siteUrl)) {
    return false;
  }

  const site = new URL(siteUrl);

  if (credential.siteMatchMode === "origin") {
    return site.origin === credential.siteOrigin;
  }

  return site.hostname === credential.siteHostname;
}

export function getMatchModeLabel(mode: SiteMatchMode) {
  return mode === "origin" ? "Exact origin" : "Hostname";
}
