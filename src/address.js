// Turns what the user typed in the address box into a page to open, or null when it's refused.
function toUrl(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return URL.canParse(t) ? t : null;
  // Any other scheme (file:, javascript:, data:...). The (?!\d) keeps "site.com:8080" from counting.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t)) return null;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t)) return `https://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}

module.exports = { toUrl };
