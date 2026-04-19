"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type Reply = {
  id: string;
  from_email: string;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  created_at: string;
  recipient: { id: string; name: string; company: string } | null;
  campaign: { id: string; name: string } | null;
};

export default function RepliesPage() {
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [running, setRunning] = useState(false);

  async function load() {
    const r = await fetch("/api/replies", { cache: "no-store" });
    const d = await r.json();
    setReplies(d.replies ?? []);
  }

  useEffect(() => { load(); }, []);

  async function runNow() {
    setRunning(true);
    setTimeout(() => { load(); setRunning(false); }, 1000);
  }

  return (
    <AppShell>
      <div className="page">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">Replies</h1>
            <p className="text-[13px] text-ink-500 mt-1">
              {replies === null ? "Loading…" : `${replies.length} inbound messages from recipients`}
            </p>
          </div>
          <button type="button" onClick={runNow} disabled={running} className="btn-ghost text-[13px]">
            {running ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {replies === null && <p className="text-[13px] text-ink-500">Loading…</p>}

        {replies?.length === 0 && (
          <div className="text-center py-16 border border-dashed border-ink-200 rounded-lg">
            <div className="text-[14px] font-medium text-ink mb-1">No replies yet</div>
            <p className="text-[13px] text-ink-500 max-w-md mx-auto">
              Replies appear here within 5 min of landing in Gmail. Make sure the Supabase cron is wired up.
            </p>
          </div>
        )}

        {replies && replies.length > 0 && (
          <div className="sheet overflow-hidden">
            {replies.map((r) => (
              <div key={r.id} className="flex items-start gap-4 px-4 py-3 border-b border-ink-100 last:border-b-0 hover:bg-hover transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-medium truncate">
                      {r.recipient?.name ?? r.from_email}
                    </span>
                    {r.recipient?.company && (
                      <span className="text-[13px] text-ink-500">@ {r.recipient.company}</span>
                    )}
                    {r.campaign && (
                      <Link href={`/campaigns/${r.campaign.id}`} className="pill-paper hover:bg-ink hover:text-paper transition-colors">
                        {r.campaign.name}
                      </Link>
                    )}
                  </div>
                  <div className="text-[13px] text-ink-700 mt-0.5 truncate" title={r.subject ?? ""}>
                    {r.subject ?? <span className="italic text-ink-400">(no subject)</span>}
                  </div>
                  <div className="text-[11px] font-mono text-ink-400 mt-0.5">{r.from_email}</div>
                </div>
                <div className="text-[12px] text-ink-500 whitespace-nowrap pt-1">
                  {r.received_at
                    ? new Date(r.received_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                    : new Date(r.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short" })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
