import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export type IncomingMessage = {
  from: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  date: Date | null;
};

// Poll Gmail over IMAP for inbound messages. Capped at `maxMessages` newest
// within the `since` window so the cron function doesn't time out on active
// inboxes (Vercel 60s budget).
export async function fetchIncomingMessages(
  creds: { email: string; appPassword: string },
  since: Date,
  opts: { maxMessages?: number } = {}
): Promise<IncomingMessage[]> {
  const max = opts.maxMessages ?? 500;
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword.replace(/\s+/g, "") },
    logger: false,
    socketTimeout: 25_000,
  });

  const out: IncomingMessage[] = [];
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const uids = await client.search({ since });
    if (!uids || uids.length === 0) return [];
    // Only inspect the newest `max` UIDs (UIDs are monotonic — largest = newest).
    const slice = (uids as number[]).slice(-max);
    for await (const msg of client.fetch(slice, { envelope: true, source: true })) {
      const addr = msg.envelope?.from?.[0]?.address?.toLowerCase();
      if (!addr) continue;
      let bodyText: string | null = null;
      let bodyHtml: string | null = null;
      let snippet: string | null = null;
      if (msg.source) {
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          bodyText = parsed.text ?? null;
          bodyHtml = typeof parsed.html === "string" ? parsed.html : null;
          // Short preview: first 200 chars of plain text, collapsed whitespace
          if (bodyText) {
            snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 200);
          }
        } catch {
          // ignore parse errors, keep envelope info only
        }
      }
      out.push({
        from: addr,
        subject: msg.envelope?.subject ?? null,
        snippet,
        body_text: bodyText,
        body_html: bodyHtml,
        date: msg.envelope?.date ?? null,
      });
    }
  } finally {
    try { await client.logout(); } catch {}
  }
  return out;
}

// Backwards-compat wrapper (not used anymore but kept so callers don't break)
export async function fetchIncomingSenders(
  creds: { email: string; appPassword: string },
  since: Date
): Promise<string[]> {
  const msgs = await fetchIncomingMessages(creds, since);
  return Array.from(new Set(msgs.map((m) => m.from)));
}
