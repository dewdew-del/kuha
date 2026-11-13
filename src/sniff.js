// Decides whether a response the page view received is a video, and keeps the per-page list of finds.
const MB = 1024 * 1024;
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)$/;
const MAX_FINDS = 30;

function classify({ url, contentType, contentLength, statusCode }) {
  if (statusCode !== 200 && statusCode !== 206) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const path = u.pathname.toLowerCase();

  if (/\.(ts|m4s)$/.test(path) || type === "video/mp2t") return null; // pieces of a stream, not the stream
  if (type === "application/vnd.apple.mpegurl" || type === "application/x-mpegurl" || path.endsWith(".m3u8")) return "hls";
  if (type === "application/dash+xml" || path.endsWith(".mpd")) return "dash";

  const hasExt = VIDEO_EXT.test(path);
  const unknown = contentLength == null;
  if (type.startsWith("video/")) return contentLength >= MB || (unknown && hasExt) ? "file" : null;
  // Many file hosts send videos with no type or as a generic download.
  if ((type === "" || type === "application/octet-stream") && hasExt && (unknown || contentLength >= MB)) return "file";
  return null;
}

// Electron gives headers as { Name: [value] } in whatever case the server used.
function fromHeaders(headers) {
  const get = (name) => {
    for (const k of Object.keys(headers || {})) {
      if (k.toLowerCase() === name) return String([].concat(headers[k])[0] ?? "");
    }
    return null;
  };
  const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
  const range = get("content-range");
  const length = get("content-length");
  // A ranged reply's Content-Length is only the piece; the whole file's size is after the slash.
  const contentLength = range !== null ? num(range.split("/")[1] || "") : length !== null ? num(length.trim()) : null;
  return { contentType: get("content-type") || "", contentLength };
}

function detail(entry) {
  if (entry.kind !== "file") return "Stream";
  let ext = null;
  try {
    ext = VIDEO_EXT.exec(new URL(entry.url).pathname.toLowerCase());
  } catch {}
  const name = ext ? ext[1].toUpperCase() : "Video";
  return entry.sizeBytes ? `${name}, ${Math.max(1, Math.round(entry.sizeBytes / MB))} MB` : name;
}

function createFinds() {
  let items = [];
  let nextId = 1; // never reset, so an id from an earlier page can't match a new find

  function add({ kind, url, sizeBytes = null, title = null }) {
    if (kind === "site") {
      items = items.filter((x) => x.kind !== "site");
      items.unshift({ id: String(nextId++), kind, url, sizeBytes: null, title });
      return true;
    }
    if (items.some((x) => x.url === url)) return false;
    items.push({ id: String(nextId++), kind, url, sizeBytes, title: null });
    if (items.length > MAX_FINDS) items.splice(items.findIndex((x) => x.kind !== "site"), 1);
    return true;
  }

  const list = (pageTitle) =>
    items.map((x) => ({
      id: x.id,
      kind: x.kind,
      label: x.kind === "site" ? x.title || "Video" : `${pageTitle || "Video"} (${detail(x)})`,
      sizeBytes: x.sizeBytes,
    }));

  return {
    add,
    list,
    clear: () => { items = []; },
    get: (id) => items.find((x) => x.id === id),
  };
}

module.exports = { classify, fromHeaders, createFinds };
