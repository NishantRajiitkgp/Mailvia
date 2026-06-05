// Minimal OpenAI-compatible chat client. Works with OpenAI and Groq (and any
// other OpenAI-compatible endpoint) by pointing AI_BASE_URL at the right host.
//
//   OpenAI:  AI_BASE_URL=https://api.openai.com/v1      AI_MODEL=gpt-4o-mini
//   Groq:    AI_BASE_URL=https://api.groq.com/openai/v1 AI_MODEL=llama-3.3-70b-versatile
//
// Only the chat-completions endpoint is used, so no SDK dependency is needed.

export function aiConfigured(): boolean {
  return !!process.env.AI_API_KEY;
}

function baseUrl(): string {
  return (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

function model(): string {
  return process.env.AI_MODEL || "gpt-4o-mini";
}

export async function chat(args: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error("AI not configured — set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL).");

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model(),
      temperature: args.temperature ?? 0.5,
      max_tokens: args.maxTokens ?? 600,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string } | string;
  };

  if (!res.ok) {
    const detail =
      typeof json.error === "string"
        ? json.error
        : json.error?.message || `HTTP ${res.status}`;
    throw new Error(`ai_request_failed: ${detail}`);
  }

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("ai_empty_response");
  return content;
}
