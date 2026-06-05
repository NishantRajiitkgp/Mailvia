import nodemailer from "nodemailer";
import type { MailProvider } from "@/lib/supabase";
import { sendGraphMail, verifyGraphCreds } from "@/lib/graph";

type SenderCreds = {
  email: string;
  appPassword: string; // for microsoft_graph this holds the OAuth client secret
  fromName?: string | null;
  provider?: MailProvider | null;
  msTenantId?: string | null;
  msClientId?: string | null;
};

function isGraph(creds: SenderCreds): boolean {
  return creds.provider === "microsoft_graph";
}

function graphCreds(creds: SenderCreds) {
  if (!creds.msTenantId || !creds.msClientId || !creds.appPassword) {
    throw new Error("microsoft_graph sender is missing tenant id / client id / client secret");
  }
  return { tenantId: creds.msTenantId, clientId: creds.msClientId, clientSecret: creds.appPassword };
}

type SmtpConfig = { host: string; port: number; secure: boolean; requireTLS?: boolean };

// SMTP endpoints per provider. Gmail uses implicit TLS on 465; Outlook (both
// personal Outlook.com and SMTP-AUTH-enabled M365) uses STARTTLS on 587.
const SMTP: Record<MailProvider, SmtpConfig> = {
  gmail: { host: "smtp.gmail.com", port: 465, secure: true },
  outlook: { host: "smtp-mail.outlook.com", port: 587, secure: false, requireTLS: true },
};

function smtpConfig(provider?: MailProvider | null): SmtpConfig {
  return SMTP[provider ?? "gmail"] ?? SMTP.gmail;
}

function fallbackEnv(): SenderCreds {
  const email = process.env.GMAIL_ADDRESS;
  const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!email || !appPassword) throw new Error("No sender configured and GMAIL_ADDRESS/GMAIL_APP_PASSWORD not set");
  return { email, appPassword, fromName: process.env.GMAIL_FROM_NAME, provider: "gmail" };
}

const cache = new Map<string, nodemailer.Transporter>();

function makeTransporter(creds: SenderCreds) {
  const cfg = smtpConfig(creds.provider);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTLS,
    auth: { user: creds.email, pass: creds.appPassword.replace(/\s+/g, "") },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
  });
}

function transporter(creds: SenderCreds) {
  const hit = cache.get(creds.email);
  if (hit) return hit;
  const t = makeTransporter(creds);
  cache.set(creds.email, t);
  return t;
}

function invalidate(email: string) {
  const hit = cache.get(email);
  if (hit) {
    try { hit.close(); } catch {}
    cache.delete(email);
  }
}

export async function sendMail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  sender?: SenderCreds | null;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  headers?: Record<string, string>;
}): Promise<string | null> {
  const creds = args.sender ?? fallbackEnv();

  // Microsoft Graph path (app-only OAuth) — no SMTP. Returns no Message-ID
  // (sendMail is fire-and-forget 202), so threading/reply-match falls back to
  // the from-address heuristic in check-replies.
  if (isGraph(creds)) {
    await sendGraphMail({
      mailbox: creds.email,
      fromName: creds.fromName,
      creds: graphCreds(creds),
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      attachments: args.attachments,
      headers: args.headers,
    });
    return null;
  }

  const from = creds.fromName ? `"${creds.fromName}" <${creds.email}>` : creds.email;
  try {
    const info = await transporter(creds).sendMail({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      replyTo: creds.email,
      attachments: args.attachments,
      headers: args.headers,
    });
    return info.messageId;
  } catch (e) {
    // SMTP session might be stale/broken — drop the cached transporter so the
    // next send rebuilds a fresh connection instead of retrying a dead socket.
    invalidate(creds.email);
    throw e;
  }
}

export async function verifyCredentials(creds: SenderCreds): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isGraph(creds)) {
    return verifyGraphCreds(graphCreds(creds));
  }
  try {
    await transporter(creds).verify();
    return { ok: true };
  } catch (e) {
    invalidate(creds.email);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
