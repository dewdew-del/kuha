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

// True when two page addresses differ at most in the #fragment (anchors, player time marks),
// so it is still the same page and its found videos stay.
function samePage(a, b) {
  const bare = (u) => String(u).split("#")[0];
  return bare(a) === bare(b);
}

// True when two addresses belong to the same main site (www.example.com and video.example.com).
// shortcut: "main site" is the last two labels, so a.co.uk and b.co.uk count as one site;
// upgrade to a public-suffix list if that lets ad pop-ups through.
function sameSite(a, b) {
  const site = (u) => {
    try {
      return new URL(u).hostname.toLowerCase().split(".").slice(-2).join(".");
    } catch {
      return null;
    }
  };
  const x = site(a);
  return !!x && x === site(b);
}

module.exports = { toUrl, samePage, sameSite };
