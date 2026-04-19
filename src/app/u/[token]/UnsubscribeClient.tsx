"use client";

import { useState } from "react";

export default function UnsubscribeClient({ token, email }: { token: string; email: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function confirm() {
    setState("loading");
    const r = await fetch("/api/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setState(r.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <div className="mt-8 pt-6 rule">
        <div className="kicker">Unsubscribed</div>
        <p className="mt-2">You won't receive any more emails from this sender. Sorry for the noise.</p>
      </div>
    );
  }

  return (
    <div className="mt-10 flex flex-col sm:flex-row gap-3">
      <button onClick={confirm} disabled={state === "loading"} className="btn-accent">
        {state === "loading" ? "Unsubscribing…" : `Unsubscribe ${email}`}
      </button>
      <a href="/" className="btn-quiet">Keep me subscribed</a>
      {state === "error" && (
        <p className="text-sm text-red-700 mt-2">Something went wrong. Try again.</p>
      )}
    </div>
  );
}
