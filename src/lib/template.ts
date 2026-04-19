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
    return v !== undefined && v !== "" ? v : `{{${k}}}`;
  });
}

export function extractTags(tpl: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG.source, "g");
  while ((m = re.exec(tpl))) out.add(m[1].trim());
  return Array.from(out);
}

export function toHtml(
  text: string,
  opts?: { wrapUrl?: (url: string) => string; openPixelUrl?: string; unsubscribeUrl?: string }
) {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withLinks = esc.replace(MD_LINK, (_m, label, url) => {
    const finalUrl = opts?.wrapUrl ? opts.wrapUrl(String(url)) : String(url);
    const safeUrl = finalUrl.replace(/"/g, "&quot;");
    return `<a href="${safeUrl}" style="color:#2563eb;text-decoration:underline;">${label}</a>`;
  });
  const withBreaks = withLinks.replace(/\n/g, "<br>\n");
  const footer = opts?.unsubscribeUrl
    ? `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;color:#888;font-size:11px;">If you'd rather not hear from me, <a href="${opts.unsubscribeUrl}" style="color:#888;">unsubscribe</a>.</div>`
    : "";
  const pixel = opts?.openPixelUrl
    ? `<img src="${opts.openPixelUrl}" width="1" height="1" alt="" style="display:block;border:0;opacity:0;" />`
    : "";
  return (
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;' +
    'font-size:14px;line-height:1.55;color:#222;">' +
    withBreaks +
    footer +
    pixel +
    "</div>"
  );
}

export function toPlain(text: string, opts?: { unsubscribeUrl?: string }) {
  let out = text.replace(MD_LINK, (_m, label, url) => `${label} (${url})`);
  if (opts?.unsubscribeUrl) out += `\n\n---\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return out;
}
