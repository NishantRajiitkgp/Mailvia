import { marked } from "marked";

const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const TAG = /\{\{\s*([^}]+?)\s*\}\}/g;

export function render(tpl: string, vars: Record<string, string>) {
  const resolved: Record<string, string> = {
    ...vars,
    Name: vars.Name ?? vars["First Name"] ?? vars.FirstName ?? "",
    Company: vars.Company ?? vars["Company Name"] ?? "",
  };
  return tpl.replace(TAG, (_m, key) => {
    const k = String(key).trim();
    const v = resolved[k];
    if (Object.prototype.hasOwnProperty.call(resolved, k)) return v ?? "";
    return `{{${k}}}`;
  });
}

export function extractTags(tpl: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG.source, "g");
  while ((m = re.exec(tpl))) out.add(m[1].trim());
  return Array.from(out);
}

function escapeAttr(v: string) {
  return String(v).replace(/"/g, "&quot;");
}

export function toHtml(
  text: string,
  opts?: { wrapUrl?: (url: string) => string; openPixelUrl?: string; unsubscribeUrl?: string }
) {
  // Full markdown parsing — bold, italic, strike, headings, lists, links, quotes, code.
  let html = marked.parse(text, { gfm: true, breaks: true, async: false }) as string;

  // Inject blue-underline + optional click-tracking wrap on every <a>
  html = html.replace(/<a\s+([^>]*?)href="([^"]*)"([^>]*)>/g, (_m, pre, href, post) => {
    const finalHref = opts?.wrapUrl ? opts.wrapUrl(href) : href;
    return `<a ${pre}href="${escapeAttr(finalHref)}"${post} style="color:#2563eb;text-decoration:underline;">`;
  });

  const footer = opts?.unsubscribeUrl
    ? `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;color:#888;font-size:11px;">If you'd rather not hear from me, <a href="${escapeAttr(opts.unsubscribeUrl)}" style="color:#888;">unsubscribe</a>.</div>`
    : "";
  const pixel = opts?.openPixelUrl
    ? `<img src="${escapeAttr(opts.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;opacity:0;" />`
    : "";

  return (
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;' +
    'font-size:14px;line-height:1.55;color:#222;">' +
    html +
    footer +
    pixel +
    "</div>"
  );
}

export function toPlain(text: string, opts?: { unsubscribeUrl?: string }) {
  // Strip markdown markers for the plain-text part
  let out = text
    .replace(MD_LINK, (_m, label, url) => `${label} (${url})`)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "");
  if (opts?.unsubscribeUrl) out += `\n\n---\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return out;
}
