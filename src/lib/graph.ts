// Microsoft Graph sender (app-only / client-credentials flow).
//
// Used by the "microsoft_graph" provider so we can send from Microsoft 365
// business mailboxes (e.g. user@company.com) where Basic Auth / app-password
// SMTP is disabled. Requires an Entra app registration with the Graph
// *application* permission `Mail.Send` and admin consent granted.
//
// No SMTP, no IMAP, no per-user sign-in — the app exchanges
// tenant_id + client_id + client_secret for a token and POSTs to
// /users/{mailbox}/sendMail. Fits the stateless cron model.

export type GraphCreds = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

type GraphAttachment = { filename: string; content: Buffer; contentType?: string };

// Cache access tokens per (tenant, client). Graph tokens last ~1h; we refresh
// a minute early to avoid edge-of-expiry failures.
const tokenCache = new Map<string, { token: string; exp: number }>();

async function getToken(creds: GraphCreds): Promise<string> {
  const key = `${creds.tenantId}:${creds.clientId}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }
  );

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`graph_token_failed: ${detail}`);
  }

  tokenCache.set(key, {
    token: json.access_token,
    exp: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}

export async function sendGraphMail(args: {
  mailbox: string; // the M365 user mailbox we send as
  fromName?: string | null;
  creds: GraphCreds;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: GraphAttachment[];
  headers?: Record<string, string>;
}): Promise<void> {
  const token = await getToken(args.creds);

  // Graph only accepts custom headers prefixed with `x-` via
  // internetMessageHeaders. Standard headers (List-Unsubscribe, In-Reply-To,
  // References) can't be set this way and are dropped — the unsubscribe link
  // still lives in the HTML body, and open/click tracking is body-based too.
  const customHeaders = Object.entries(args.headers ?? {})
    .filter(([k]) => k.toLowerCase().startsWith("x-"))
    .map(([name, value]) => ({ name, value }));

  const message: Record<string, unknown> = {
    subject: args.subject,
    body: { contentType: "HTML", content: args.html },
    toRecipients: [{ emailAddress: { address: args.to } }],
    from: { emailAddress: { address: args.mailbox, name: args.fromName ?? undefined } },
    replyTo: [{ emailAddress: { address: args.mailbox } }],
  };
  if (customHeaders.length > 0) message.internetMessageHeaders = customHeaders;
  if (args.attachments && args.attachments.length > 0) {
    message.attachments = args.attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.filename,
      contentType: a.contentType ?? "application/octet-stream",
      contentBytes: a.content.toString("base64"),
    }));
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(args.mailbox)}/sendMail`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    }
  );

  // sendMail returns 202 Accepted with an empty body on success.
  if (res.status !== 202 && !res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: string } };
      if (j?.error?.message) detail = `${j.error.code ?? ""} ${j.error.message}`.trim();
    } catch {
      // non-JSON body
    }
    throw new Error(`graph_send_failed: ${detail}`);
  }
}

// Verify that the client credentials are valid (token can be minted).
// Note: this confirms the app registration + secret, not mailbox access —
// a missing Mail.Send grant or wrong mailbox only surfaces on first send.
export async function verifyGraphCreds(
  creds: GraphCreds
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getToken(creds);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
