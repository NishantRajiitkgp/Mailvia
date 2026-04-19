import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken } from "@/lib/tokens";
import UnsubscribeClient from "./UnsubscribeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyToken("u", token);
  if (!id) {
    return (
      <Shell>
        <div className="kicker">Invalid link</div>
        <h1 className="display-lg mt-2">That link isn't valid.</h1>
        <p className="standfirst mt-3">It may have expired. If you want to stop receiving emails, reply to the sender directly.</p>
      </Shell>
    );
  }
  const db = supabaseAdmin();
  const { data: recipient } = await db
    .from("recipients")
    .select("email, campaign_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!recipient) {
    return (
      <Shell>
        <div className="kicker">Not found</div>
        <h1 className="display-lg mt-2">We couldn't find you.</h1>
      </Shell>
    );
  }
  const already = recipient.status === "unsubscribed";
  return (
    <Shell>
      <div className="kicker">Unsubscribe</div>
      <h1 className="display-lg mt-2">{already ? "You're already unsubscribed." : "Not for you?"}</h1>
      <p className="standfirst mt-4 max-w-lg">
        {already ? (
          <>No more messages will reach <b>{recipient.email}</b>.</>
        ) : (
          <>Confirm and we'll stop emailing <b>{recipient.email}</b> from this sender — including any scheduled follow-ups.</>
        )}
      </p>
      {!already && <UnsubscribeClient token={token} email={recipient.email} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper grid grid-cols-1 md:grid-cols-[1.15fr,1fr]">
      <aside className="hidden md:flex flex-col justify-between p-10 border-r-2 border-ink bg-ink text-paper">
        <div>
          <div className="kicker text-paper/70">Vol. I · Issue 01</div>
          <div className="mt-2 font-display text-4xl font-medium tracking-tightest">Mailvia</div>
        </div>
        <div className="font-display text-3xl leading-[1.1] text-paper/90">
          <em className="not-italic text-accent">Every reader deserves</em><br />
          a quiet inbox.
        </div>
        <div className="text-xs text-paper/60">—</div>
      </aside>
      <main className="flex items-center p-6 md:p-16">
        <div className="max-w-lg">{children}</div>
      </main>
    </div>
  );
}
