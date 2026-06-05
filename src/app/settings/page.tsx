"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";

export default function SettingsPage() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setDone(false);
    if (form.next !== form.confirm) {
      setErr("New password and confirmation don't match.");
      return;
    }
    if (form.next.length < 8) {
      setErr("New password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current: form.current, next: form.next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof d.error === "string" ? d.error : `Failed (HTTP ${r.status}).`);
        return;
      }
      setDone(true);
      setForm({ current: "", next: "", confirm: "" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="page-narrow">
        <div className="mb-6">
          <h1 className="text-[28px] font-bold tracking-tight">Settings</h1>
          <p className="text-[13px] text-ink-500 mt-1">Manage your workspace login.</p>
        </div>

        <form onSubmit={onSubmit} className="sheet p-5 max-w-lg">
          <h2 className="text-[16px] font-semibold mb-1">Change password</h2>
          <p className="text-[13px] text-ink-500 mb-5">
            This is the shared password used to sign in to Mailvia. Changing it affects everyone who logs in.
          </p>

          <div className="space-y-4">
            <div>
              <label className="label-cap">Current password</label>
              <input
                type="password"
                className="field-boxed"
                value={form.current}
                onChange={(e) => setForm({ ...form, current: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="label-cap">New password</label>
              <input
                type="password"
                className="field-boxed"
                value={form.next}
                onChange={(e) => setForm({ ...form, next: e.target.value })}
                autoComplete="new-password"
                required
              />
              <p className="text-[11px] text-ink-500 mt-1.5">At least 8 characters.</p>
            </div>
            <div>
              <label className="label-cap">Confirm new password</label>
              <input
                type="password"
                className="field-boxed"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          {err && <div className="mt-4 bg-red-50 text-red-700 text-[13px] px-3 py-2 rounded-md">{err}</div>}
          {done && <div className="mt-4 bg-green-50 text-green-700 text-[13px] px-3 py-2 rounded-md">Password updated. Use the new password next time you sign in.</div>}

          <div className="flex justify-end mt-5 pt-4 border-t border-ink-100">
            <button type="submit" disabled={saving} className="btn-accent">
              {saving ? "Saving…" : "Update password"}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
