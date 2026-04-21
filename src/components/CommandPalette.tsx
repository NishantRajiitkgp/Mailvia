"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Campaign = { id: string; name: string; status: string; subject: string };
type Sender = { id: string; label: string; email: string };

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const router = useRouter();

  // ⌘K / Ctrl+K to toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Lazy-load data when the palette opens (keeps initial load light)
  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch("/api/campaigns?archived=1", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ campaigns: [] })),
      fetch("/api/senders", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ senders: [] })),
    ]).then(([c, s]) => {
      setCampaigns(c.campaigns ?? []);
      setSenders(s.senders ?? []);
    });
  }, [open]);

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  function runAction(fn: () => Promise<void> | void) {
    return async () => {
      setOpen(false);
      await fn();
    };
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/40" />
          <div className="relative w-full max-w-xl bg-paper border border-ink-200 rounded-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <Command
              label="Command palette"
              filter={(value, search) => {
                if (!search) return 1;
                return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
              }}
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-200">
                <svg className="w-4 h-4 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <Command.Input
                  autoFocus
                  placeholder="Search campaigns, senders, actions…"
                  className="flex-1 bg-transparent outline-none text-[14px] text-ink placeholder:text-ink-400"
                />
                <kbd className="text-[10px] text-ink-500 border border-ink-200 rounded px-1.5 py-0.5 font-mono">ESC</kbd>
              </div>

              <Command.List className="max-h-[50vh] overflow-y-auto py-1">
                <Command.Empty className="py-8 text-center text-[13px] text-ink-500">
                  No results.
                </Command.Empty>

                <Command.Group heading="Navigate" className="px-1.5">
                  <Item onSelect={() => go("/")}>
                    <NavIcon /> <span>Campaigns</span>
                  </Item>
                  <Item onSelect={() => go("/replies")}>
                    <NavIcon /> <span>Replies</span>
                  </Item>
                  <Item onSelect={() => go("/senders")}>
                    <NavIcon /> <span>Senders</span>
                  </Item>
                  <Item onSelect={() => go("/campaigns/new")}>
                    <PlusIcon /> <span>New campaign</span>
                  </Item>
                </Command.Group>

                {campaigns.length > 0 && (
                  <Command.Group heading="Campaigns" className="px-1.5">
                    {campaigns.map((c) => (
                      <Item key={c.id} value={`campaign-${c.name}-${c.subject}`} onSelect={() => go(`/campaigns/${c.id}`)}>
                        <CampaignIcon />
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="text-[11px] text-ink-500 capitalize">{c.status}</span>
                      </Item>
                    ))}
                  </Command.Group>
                )}

                {senders.length > 0 && (
                  <Command.Group heading="Senders" className="px-1.5">
                    {senders.map((s) => (
                      <Item key={s.id} value={`sender-${s.label}-${s.email}`} onSelect={() => go("/senders")}>
                        <MailIcon />
                        <span className="flex-1 truncate">{s.label}</span>
                        <span className="text-[11px] font-mono text-ink-500 truncate max-w-[180px]">{s.email}</span>
                      </Item>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Actions" className="px-1.5">
                  <Item onSelect={runAction(async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    router.push("/login");
                  })}>
                    <LogoutIcon /> <span>Sign out</span>
                  </Item>
                </Command.Group>
              </Command.List>

              <div className="border-t border-ink-200 px-3 py-2 flex items-center justify-between text-[11px] text-ink-500">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><kbd className="bg-ink-100 border border-ink-200 rounded px-1 text-[9px] font-mono">↑↓</kbd> navigate</span>
                  <span className="flex items-center gap-1"><kbd className="bg-ink-100 border border-ink-200 rounded px-1 text-[9px] font-mono">↵</kbd> select</span>
                </div>
                <span className="flex items-center gap-1"><kbd className="bg-ink-100 border border-ink-200 rounded px-1 text-[9px] font-mono">⌘K</kbd> toggle</span>
              </div>
            </Command>
          </div>
        </div>
      )}
    </>
  );
}

function Item({
  children, onSelect, value,
}: { children: React.ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex items-center gap-2 px-3 py-2 rounded-md text-[13px] text-ink cursor-pointer aria-selected:bg-hover"
    >
      {children}
    </Command.Item>
  );
}

function NavIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>;
}
function PlusIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}
function CampaignIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
}
function MailIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
function LogoutIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17l5-5-5-5M20 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /></svg>;
}
