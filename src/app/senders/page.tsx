"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type Sender = {
  id: string;
  label: string;
  email: string;
  from_name: string | null;
  is_default: boolean;
  created_at: string;
};

export default function SendersPage() {
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", email: "", app_password: "", from_name: "", is_default: false });
  const [saving, setSaving] = useState(false);

  async function load() {
    const r = await fetch("/api/senders", { cache: "no-store" });
    const data = await r.json();
    setSenders(data.senders ?? []);
  }
  useEffect(() => { load(); }, []);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const r = await fetch("/api/senders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: form.label,
        email: form.email.toLowerCase().trim(),
        app_password: form.app_password,
        from_name: form.from_name || null,
        is_default: form.is_default,
      }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (typeof j.error === "string") setErr(j.error);
      else if (j.error && typeof j.error === "object") setErr(JSON.stringify(j.error));
      else setErr(`Failed (HTTP ${r.status}).`);
      return;
    }
    setForm({ label: "", email: "", app_password: "", from_name: "", is_default: false });
    setAdding(false);
    await load();
  }

  async function setDefault(id: string) {
    await fetch(`/api/senders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this sender? Campaigns using it will fall back to the env-var Gmail.")) return;
    await fetch(`/api/senders/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <AppShell>
      <div className="page-narrow">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">Senders</h1>
            <p className="text-[13px] text-ink-500 mt-1">Gmail accounts authorized to send campaigns.</p>
          </div>
          {!adding && <button className="btn-accent" onClick={() => setAdding(true)}>+ Add sender</button>}
        </div>

        {adding && (
          <form onSubmit={onAdd} className="sheet p-5 mb-6">
            <h2 className="text-[16px] font-semibold mb-1">New sender</h2>
            <p className="text-[13px] text-ink-500 mb-5">
              Use an <b>app password</b>, not your Gmail login. Generate at{" "}
              <a className="btn-link" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                myaccount.google.com/apppasswords
              </a>
              . 2FA must be on.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label-cap">Label</label>
                <input className="field-boxed" placeholder="Personal · Work" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
              </div>
              <div>
                <label className="label-cap">Display name</label>
                <input className="field-boxed" placeholder="Nishant Raj" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
              </div>
              <div>
                <label className="label-cap">Gmail address</label>
                <input className="field-boxed" type="email" placeholder="you@gmail.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div>
                <label className="label-cap">App password</label>
                <input className="field-boxed font-mono" placeholder="xxxx xxxx xxxx xxxx" value={form.app_password} onChange={(e) => setForm({ ...form, app_password: e.target.value })} required />
                <p className="text-[11px] text-ink-500 mt-1.5">16 lowercase letters Google generates — not your login password.</p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[13px] mt-5 cursor-pointer w-fit">
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="w-4 h-4 accent-accent" />
              <span>Make this the default sender for new campaigns</span>
            </label>

            {err && (
              <div className="mt-4 bg-red-50 text-red-700 text-[13px] px-3 py-2 rounded-md">
                {err}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-ink-100">
              <button type="button" className="btn-quiet" onClick={() => { setAdding(false); setErr(null); }}>Cancel</button>
              <button type="submit" disabled={saving} className="btn-accent">
                {saving ? "Verifying…" : "Add & verify"}
              </button>
            </div>
          </form>
        )}

        {senders === null && <p className="text-[13px] text-ink-500">Loading…</p>}

        {senders?.length === 0 && !adding && (
          <div className="text-center py-16 border border-dashed border-ink-200 rounded-lg">
            <div className="text-[14px] font-medium text-ink mb-1">No senders yet</div>
            <p className="text-[13px] text-ink-500 mb-4">Add a Gmail account to start sending.</p>
            <button onClick={() => setAdding(true)} className="btn-accent">Add your first</button>
          </div>
        )}

        {senders && senders.length > 0 && (
          <div className="sheet overflow-hidden">
            {senders.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-3 border-b border-ink-100 last:border-b-0 hover:bg-hover transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium truncate">{s.label}</span>
                    {s.is_default && <span className="pill-live">default</span>}
                  </div>
                  <div className="text-[13px] text-ink-500 truncate mt-0.5">
                    {s.from_name ? <>{s.from_name} <span className="text-ink-400">&lt;{s.email}&gt;</span></> : s.email}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!s.is_default && <button className="btn-quiet text-[12px]" onClick={() => setDefault(s.id)}>Set default</button>}
                  <button className="btn-quiet text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => remove(s.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
