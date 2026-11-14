// Small pure helpers for the screen (no page access, so they can be tested).

// Which browser action a key press means, or null. Alt+Left/Right, Ctrl+L, F5, Ctrl+R, Esc.
function matchShortcut(e) {
  const k = String(e.key || "");
  const lower = k.toLowerCase();
  if (e.metaKey) return null;
  if (e.altKey) {
    if (e.ctrlKey || e.shiftKey) return null; // AltGr arrives as Ctrl+Alt on some layouts
    return k === "ArrowLeft" ? "back" : k === "ArrowRight" ? "forward" : null;
  }
  if (e.ctrlKey && !e.shiftKey && lower === "l") return "address";
  if (e.ctrlKey && lower === "r") return "reload";
  if (!e.ctrlKey && k === "F5") return "reload";
  if (!e.ctrlKey && !e.shiftKey && k === "Escape") return "escape";
  return null;
}

// 65 -> "1:05", 3725 -> "1:02:05", no duration -> "".
function fmtTime(s) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}

// "https://www.youtube.com/watch?v=1" -> "youtube.com", "" for anything that isn't a link.
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

if (typeof module !== "undefined") module.exports = { matchShortcut, fmtTime, hostOf };
