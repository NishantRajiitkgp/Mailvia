import { ImapFlow } from "imapflow";

export type IncomingMessage = {
  from: string;
  subject: string | null;
  snippet: string | null;
  date: Date | null;
};

// Poll Gmail over IMAP for inbound messages.
// Returns lowercased-address + subject + snippet + date for every message since `since`.
export async function fetchIncomingMessages(
  creds: { email: string; appPassword: string },
  since: Date
): Promise<IncomingMessage[]> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword.replace(/\s+/g, "") },
    logger: false,
  });

  const out: IncomingMessage[] = [];
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const uids = await client.search({ since });
    if (!uids || uids.length === 0) return [];
    for await (const msg of client.fetch(uids as number[], { envelope: true, bodyStructure: false, source: false })) {
      const addr = msg.envelope?.from?.[0]?.address?.toLowerCase();
      if (!addr) continue;
      out.push({
        from: addr,
        subject: msg.envelope?.subject ?? null,
        snippet: null, // envelope-only pull for speed; body fetch would be slow
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
