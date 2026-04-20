"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { render, toHtml } from "@/lib/template";
import type { Schedule } from "@/lib/supabase";
import AppShell from "@/components/AppShell";

type Sender = { id: string; label: string; email: string; from_name: string | null; is_default: boolean };
type FollowUpStep = { step_number: number; delay_days: number; subject: string | null; template: string };
type Stats = {
  total: number; sent: number; replied: number; failed: number; pending: number; unsubscribed: number;
  follow_ups_sent: number; retries_sent: number;
  opens: number; unique_opens: number; clicks: number; unique_clicks: number;
  rates: { open_rate: number; click_rate: number; reply_rate: number; bounce_rate: number; unsubscribe_rate: number };
  opens_by_hour: number[];
  timezone: string;
};

type Campaign = {
  id: string;
  name: string;
  subject: string;
  template: string;
  status: "draft" | "running" | "paused" | "done";
  daily_cap: number;
  gap_seconds: number;
  window_start_hour: number;
  window_end_hour: number;
  timezone: string;
  sender_id: string | null;
  schedule: Schedule | null;
  follow_ups_enabled: boolean;
  retry_enabled: boolean;
  max_retries: number;
  tracking_enabled: boolean;
  unsubscribe_enabled: boolean;
  attachment_filename: string | null;
  known_vars: string[];
  created_at: string;
  updated_at: string;
};

type Recipient = {
  id: string;
  name: string;
  company: string;
  email: string;
  vars: Record<string, string>;
  status: "pending" | "sent" | "failed" | "skipped" | "replied" | "unsubscribed" | "bounced";
  sent_at: string | null;
  error: string | null;
  row_index: number;
};

const STATUS_CLASS: Record<Recipient["status"], string> = {
  pending: "pill-draft",
  sent: "pill-done",
  failed: "pill-warn",
  skipped: "pill-draft",
  replied: "pill-live",
  unsubscribed: "pill-pause",
  bounced: "pill-warn",
};

function statusPillCampaign(s: Campaign["status"]) {
  const map = { running: "pill-live", paused: "pill-pause", done: "pill-done", draft: "pill-draft" } as const;
  const dot = { running: "dot-live", paused: "dot-pause", done: "dot-done", draft: "dot-draft" } as const;
  return <span className={map[s]}><span className={dot[s]} />{s}</span>;
}

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [steps, setSteps] = useState<FollowUpStep[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [filter, setFilter] = useState<"all" | Recipient["status"]>("all");

  async function load() {
    const r = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
    if (r.status === 404) { router.push("/"); return; }
    const data = await r.json();
    setCampaign(data.campaign);
    setRecipients(data.recipients);
  }
  async function loadSteps() {
    const r = await fetch(`/api/campaigns/${id}/follow-ups`, { cache: "no-store" });
    const d = await r.json();
    setSteps(d.steps ?? []);
  }
  async function loadStats() {
    const r = await fetch(`/api/campaigns/${id}/stats`, { cache: "no-store" });
    if (r.ok) setStats(await r.json());
  }

  useEffect(() => {
    load();
    loadSteps();
    loadStats();
    fetch("/api/senders", { cache: "no-store" }).then((r) => r.json()).then((d) => setSenders(d.senders ?? []));
    const t = setInterval(() => { load(); loadStats(); }, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patch(payload: Partial<Campaign>) {
    const r = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) await load();
  }

  async function destroy() {
    if (!confirm("Delete this campaign and all its recipients? This cannot be undone.")) return;
    const r = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (r.ok) router.push("/");
  }

  async function duplicate() {
    const r = await fetch(`/api/campaigns/${id}/duplicate`, { method: "POST" });
    if (!r.ok) { alert("Failed to duplicate"); return; }
    const { campaign: dup } = await r.json();
    router.push(`/campaigns/${dup.id}/edit`);
  }

  async function archive() {
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    router.push("/");
  }

  const [validating, setValidating] = useState(false);
  async function validateEmails() {
    setValidating(true);
    const r = await fetch(`/api/campaigns/${id}/validate`, { method: "POST" });
    setValidating(false);
    if (!r.ok) { alert("Validation failed"); return; }
    const d = await r.json();
    alert(`Checked ${d.checked}, ${d.invalid} invalid${d.invalid > 0 ? ` (${d.invalid_emails.slice(0, 5).join(", ")}${d.invalid > 5 ? "…" : ""})` : ""}.`);
    load();
  }

  const currentSender = useMemo(
    () => senders.find((s) => s.id === campaign?.sender_id),
    [senders, campaign?.sender_id]
  );

  if (!campaign) return <AppShell><div className="page text-sm text-ink-500">Loading…</div></AppShell>;

  const total = recipients.length;
  const sent = recipients.filter((r) => r.status === "sent" || r.status === "replied").length;
  const replied = recipients.filter((r) => r.status === "replied").length;
  const failed = recipients.filter((r) => r.status === "failed" || r.status === "bounced").length;
  const pending = recipients.filter((r) => r.status === "pending").length;
  const pct = total ? Math.round((sent / total) * 100) : 0;
  const activeDays = campaign.schedule ? Object.values(campaign.schedule).filter((d) => d.enabled).length : 7;

  const filtered = filter === "all" ? recipients : recipients.filter((r) => r.status === filter);
  const previewRecipient = recipients[previewIdx];

  const previewVars: Record<string, string> = previewRecipient
    ? { ...previewRecipient.vars, Name: previewRecipient.name, Company: previewRecipient.company }
    : { Name: "John", Company: "Acme Inc" };
  const previewHtml = toHtml(render(campaign.template, previewVars));

  return (
    <AppShell>
    <div className="page">
      <Link href="/" className="btn-link text-[12px]">← Campaigns</Link>

      <header className="mt-4 flex items-start justify-between gap-4 flex-wrap pb-5 border-b border-ink-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {statusPillCampaign(campaign.status)}
            <span className="text-[12px] text-ink-500">Updated {new Date(campaign.updated_at).toLocaleString()}</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight mt-2">{campaign.name}</h1>
          <p className="text-[14px] text-ink-600 mt-1 truncate max-w-2xl">{campaign.subject}</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {campaign.status !== "running" && pending > 0 && (
            <button className="btn-accent" onClick={() => patch({ status: "running" })}>Start sending</button>
          )}
          {campaign.status === "running" && (
            <button className="btn-ghost" onClick={() => patch({ status: "paused" })}>Pause</button>
          )}
          <Link href={`/campaigns/${id}/edit`} className="btn-ghost">Edit</Link>
          {pending > 0 && <button className="btn-quiet" onClick={validateEmails} disabled={validating}>{validating ? "Validating…" : "Validate"}</button>}
          <button className="btn-quiet" onClick={duplicate}>Duplicate</button>
          {campaign.status === "done" && <button className="btn-quiet" onClick={archive}>Archive</button>}
          <button className="btn-quiet text-red-600" onClick={destroy}>Delete</button>
        </div>
      </header>

      {/* big stats row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b border-ink-200 mt-0">
        <Stat label="Sent" big={`${sent}`} small={`of ${total}`} />
        <Stat label="Replied" big={`${stats?.replied ?? replied}`} small={stats && stats.rates.reply_rate > 0 ? `${stats.rates.reply_rate}% reply rate` : "—"} accent />
        <Stat label="Failed" big={`${failed}`} small={failed > 0 ? "needs attention" : "—"} />
        <Stat label="Pending" big={`${pending}`} small={`${pct}% complete`} />
      </section>

      {/* analytics row */}
      {campaign.tracking_enabled && stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b border-ink-200 -mt-px">
          <Stat label="Unique opens" big={`${stats.unique_opens}`} small={`${stats.rates.open_rate}% of sent · ${stats.opens} total`} />
          <Stat label="Unique clicks" big={`${stats.unique_clicks}`} small={`${stats.rates.click_rate}% · ${stats.clicks} total`} />
          <Stat label="Follow-ups sent" big={`${stats.follow_ups_sent}`} small={stats.follow_ups_sent > 0 ? "sequence active" : "—"} />
          <Stat label="Unsubscribed" big={`${stats.unsubscribed}`} small={stats.unsubscribed > 0 ? `${stats.rates.unsubscribe_rate}%` : "—"} />
        </section>
      )}
      {!campaign.tracking_enabled && stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b border-ink-200 -mt-px">
          <Stat label="Follow-ups sent" big={`${stats.follow_ups_sent}`} small={stats.follow_ups_sent > 0 ? "sequence active" : "—"} />
          <Stat label="Retries used" big={`${stats.retries_sent}`} small={stats.retries_sent > 0 ? "auto-retried" : "—"} />
          <Stat label="Unsubscribed" big={`${stats.unsubscribed}`} small={stats.unsubscribed > 0 ? `${stats.rates.unsubscribe_rate}%` : "—"} />
          <Stat label="Tracking" big="off" small="enable in Edit for open/click stats" />
        </section>
      )}

      <div className="h-[2px] w-full bg-ink-100 mt-0 mb-10 relative">
        <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
      </div>

      {campaign.tracking_enabled && stats && stats.opens > 0 && (
        <section className="sheet p-6 mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold">When they open</h2>
              <p className="text-[12px] text-ink-500 mt-1">
                Hourly opens in {stats.timezone}. Send ~1h before peak to land when the inbox is being read.
              </p>
            </div>
            {(() => {
              const top = stats.opens_by_hour
                .map((c, h) => ({ c, h }))
                .filter((x) => x.c > 0)
                .sort((a, b) => b.c - a.c)
                .slice(0, 3);
              if (top.length === 0) return null;
              return (
                <div className="text-right">
                  <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">Peak</div>
                  <div className="text-[12px] font-mono mt-0.5">{top.map((t) => `${String(t.h).padStart(2, "0")}:00`).join(" · ")}</div>
                </div>
              );
            })()}
          </div>
          {(() => {
            const max = Math.max(...stats.opens_by_hour, 1);
            return (
              <div>
                <div className="flex items-end gap-[3px] h-[120px]">
                  {stats.opens_by_hour.map((c, h) => {
                    const pct = (c / max) * 100;
                    return (
                      <div key={h} className="flex-1 flex flex-col justify-end h-full group relative">
                        <div
                          className={`w-full transition-all duration-300 ${c > 0 ? "bg-ink group-hover:bg-accent" : "bg-ink-100"}`}
                          style={{ height: `${Math.max(pct, c > 0 ? 6 : 2)}%`, minHeight: c > 0 ? 4 : 2 }}
                          title={`${String(h).padStart(2, "0")}:00 · ${c} open${c !== 1 ? "s" : ""}`}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2 text-[10px] font-mono text-ink-400 tracking-wider">
                  <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
                </div>
              </div>
            );
          })()}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-10">
        {/* main column */}
        <div className="space-y-10">
          {/* preview */}
          <section className="sheet p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold">Preview</h2>
              {previewRecipient && recipients.length > 1 && (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))}
                    disabled={previewIdx === 0}
                    className="w-7 h-7 flex items-center justify-center rounded text-ink-600 hover:bg-hover hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <span className="text-[11px] text-ink-500 px-2 font-mono tabular-nums whitespace-nowrap">{previewIdx + 1} / {recipients.length}</span>
                  <button
                    type="button"
                    onClick={() => setPreviewIdx(Math.min(recipients.length - 1, previewIdx + 1))}
                    disabled={previewIdx >= recipients.length - 1}
                    className="w-7 h-7 flex items-center justify-center rounded text-ink-600 hover:bg-hover hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </div>
              )}
            </div>
            {previewRecipient && (
              <div className="mb-4 pb-3 border-b border-ink-200">
                <div className="text-[13px] font-medium text-ink truncate">
                  {previewRecipient.name}
                  <span className="text-ink-400 font-normal"> · </span>
                  {previewRecipient.company}
                </div>
                <div className="text-[11px] font-mono text-ink-500 truncate">{previewRecipient.email}</div>
              </div>
            )}
            <article className="email-preview rounded-md border border-ink-200 p-6 bg-paper text-ink">
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              {campaign.attachment_filename && (
                <div className="mt-6 pt-4 border-t border-ink-200">
                  <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider mb-2">1 attachment</div>
                  <div className="inline-flex items-center gap-2.5 pl-3 pr-4 py-2 border border-ink-200 rounded-md bg-surface max-w-full">
                    <svg className="w-5 h-5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l8.57-8.57A4 4 0 0117.98 8.6l-8.07 8.07a2 2 0 11-2.83-2.83l7.77-7.77" />
                    </svg>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate" title={campaign.attachment_filename}>
                        {campaign.attachment_filename}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </article>
            <details className="mt-6 pt-4 border-t border-ink-200">
              <summary className="text-[12px] font-medium text-ink-500 hover:text-ink cursor-pointer">Show raw template</summary>
              <pre className="whitespace-pre-wrap font-mono text-[12px] bg-surface border border-ink-200 rounded-md p-3 mt-3 max-h-80 overflow-auto">{campaign.template}</pre>
            </details>
          </section>

          {/* follow-ups */}
          {campaign.follow_ups_enabled && steps.length > 0 && (
            <section className="sheet p-6">
              <h2 className="text-[15px] font-semibold mb-4">Follow-up sequence</h2>
              <div className="space-y-4">
                {steps.map((s) => (
                  <div key={s.step_number} className="grid grid-cols-[70px,1fr] gap-4">
                    <div>
                      <div className="text-[12px] font-semibold text-ink">Step {s.step_number}</div>
                      <div className="text-[11px] text-ink-500 mt-0.5">+{s.delay_days}d delay</div>
                    </div>
                    <div className="border-l border-ink-200 pl-4">
                      {s.subject && <div className="text-[13px] font-medium mb-1.5">{s.subject}</div>}
                      <pre className="whitespace-pre-wrap font-mono text-[12px] text-ink-700 max-h-48 overflow-auto">{s.template}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* recipients table */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold">Recipients <span className="text-ink-400 font-normal">({total})</span></h2>
              <div className="flex items-center gap-1">
                {(["all", "pending", "sent", "replied", "failed"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`text-[12px] px-2 py-1 rounded transition-colors capitalize cursor-pointer ${
                      filter === f ? "bg-hover text-ink font-medium" : "text-ink-500 hover:bg-hover hover:text-ink"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="sheet overflow-hidden">
              <div className="grid grid-cols-[40px,1.2fr,1fr,1.4fr,auto,auto] gap-4 px-4 py-2.5 border-b border-ink-200 text-[12px] font-medium text-ink-500">
                <span>#</span>
                <span>Name</span>
                <span>Company</span>
                <span>Email</span>
                <span>Status</span>
                <span className="text-right">When</span>
              </div>
              {filtered.length === 0 && (
                <div className="p-8 text-center text-[13px] text-ink-500">No recipients match this filter.</div>
              )}
              {filtered.map((r, i) => (
                <div key={r.id} className="grid grid-cols-[40px,1.2fr,1fr,1.4fr,auto,auto] gap-4 items-center px-4 py-2.5 text-[13px] border-b border-ink-100 last:border-b-0 hover:bg-hover transition-colors">
                  <span className="font-mono text-ink-400">{String(i + 1).padStart(3, "0")}</span>
                  <span className="font-medium truncate">{r.name}</span>
                  <span className="text-ink-700 truncate">{r.company}</span>
                  <span className="font-mono text-[11px] text-ink-500 truncate">{r.email}</span>
                  <span className={STATUS_CLASS[r.status]}>{r.status}</span>
                  <span className="text-[11px] text-ink-500 text-right">
                    {r.sent_at ? new Date(r.sent_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                      : r.error ? <span className="text-red-600 truncate block max-w-[160px]" title={r.error}>{r.error}</span>
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* sidebar */}
        <aside className="space-y-5">
          <div className="sheet p-5">
            <h3 className="text-[14px] font-semibold mb-3">Sender</h3>
            <dl className="text-[13px] space-y-1.5">
              <Row k="From">{currentSender ? (currentSender.from_name ?? currentSender.email) : "env fallback"}</Row>
              <Row k="Account" mono>{currentSender?.email ?? "—"}</Row>
              <Row k="Active days">{activeDays} / 7</Row>
              <Row k="Gap">{(campaign.gap_seconds / 60).toFixed(1)} min</Row>
              <Row k="Max/day">{campaign.daily_cap}</Row>
              <Row k="Timezone" mono>{campaign.timezone}</Row>
            </dl>
          </div>

          <div className="sheet p-5">
            <h3 className="text-[14px] font-semibold mb-3">Delivery</h3>
            <dl className="text-[13px] space-y-1.5">
              <Row k="Follow-ups">{campaign.follow_ups_enabled ? `${steps.length} step${steps.length !== 1 ? "s" : ""}` : "off"}</Row>
              <Row k="Retry">{campaign.retry_enabled ? `on · ${campaign.max_retries}x` : "off"}</Row>
              <Row k="Tracking">{campaign.tracking_enabled ? "on" : "off"}</Row>
              <Row k="Unsubscribe">{campaign.unsubscribe_enabled ? "on" : "off"}</Row>
            </dl>
          </div>

          {campaign.attachment_filename && (
            <div className="sheet p-5">
              <h3 className="text-[14px] font-semibold mb-2">Attachment</h3>
              <div className="mt-2 text-sm font-medium truncate" title={campaign.attachment_filename}>
                {campaign.attachment_filename}
              </div>
            </div>
          )}

          {campaign.known_vars.length > 0 && (
            <div className="sheet p-5">
              <h3 className="text-[14px] font-semibold mb-3">Merge tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {campaign.known_vars.map((v) => (
                  <code key={v} className="text-[11px] px-2 py-1 rounded border border-ink-200 bg-surface font-mono text-ink-700">{"{{"}{v}{"}}"}</code>
                ))}
              </div>
            </div>
          )}

          <Link href={`/campaigns/${id}/edit`} className="btn-primary w-full">Edit campaign</Link>
        </aside>
      </div>
    </div>
    </AppShell>
  );
}

function Stat({ label, big, small, accent }: { label: string; big: string; small?: string; accent?: boolean }) {
  return (
    <div className="border-r last:border-r-0 border-ink-200 border-t border-b py-4 px-5">
      <div className="text-[12px] font-medium text-ink-500">{label}</div>
      <div className={`text-[28px] font-bold mt-1 tracking-tight ${accent ? "text-ink" : "text-ink"}`}>{big}</div>
      {small && <div className="text-[11px] text-ink-500 mt-0.5">{small}</div>}
    </div>
  );
}

function Row({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className={`truncate text-right ${mono ? "font-mono text-xs" : ""}`}>{children}</dd>
    </div>
  );
}
