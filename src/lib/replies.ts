import { ImapFlow } from "imapflow";

export type IncomingMessage = {
  from: string;
  subject: string | null;
  snippet: string | null;
  date: Date | null;
};

// Poll Gmail over IMAP for inbound messages.
// Caps scan at `maxMessages` most-recent and a `sinceDays` window so the cron
// function doesn't time out on very active inboxes (Vercel 60s budget).
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
    // Only inspect the newest `max` UIDs (UIDs are monotonic — largest = newest)
    const slice = (uids as number[]).slice(-max);
    for await (const msg of client.fetch(slice, { envelope: true, bodyStructure: false, source: false })) {
      const addr = msg.envelope?.from?.[0]?.address?.toLowerCase();
      if (!addr) continue;
      out.push({
        from: addr,
        subject: msg.envelope?.subject ?? null,
        snippet: null,
        date: msg.envelope?.date ?? null,
      });
    }
  } finally {
    try { await client.logout(); } catch {}
  }
  return out;
}

// Backwards-compat wrapper used elsewhere in code
export async function fetchIncomingSenders(
  creds: { email: string; appPassword: string },
  since: Date
): Promise<string[]> {
  const msgs = await fetchIncomingMessages(creds, since);
  return Array.from(new Set(msgs.map((m) => m.from)));
}
