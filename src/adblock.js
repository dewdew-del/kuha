// Ad blocking for the page view: a list of known ad/tracker site names, and the check against it.
const fs = require("fs");

const LOCAL = new Set(["localhost", "localhost.localdomain", "local", "broadcasthost", "ip6-localhost", "ip6-loopback", "0.0.0.0"]);

// Reads a hosts-format blocklist ("0.0.0.0 ads.example.com") or one name per line.
function parseHosts(text) {
  const names = new Set();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const parts = raw.split("#")[0].trim().toLowerCase().split(/\s+/);
    const name = parts[parts.length - 1];
    // Needs a dot: single-label names in hosts files are local machine entries, not ad sites.
    if (name && name.includes(".") && !LOCAL.has(name)) names.add(name);
  }
  return names;
}

// True when the name, or a parent of it, is on the list. Stops before the last label,
// so a stray "net" on a list can never block every .net site.
function isBlocked(hostname, list) {
  let name = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  while (name.includes(".")) {
    if (list.has(name)) return true;
    name = name.slice(name.indexOf(".") + 1);
  }
  return false;
}

// A missing list just means nothing is blocked; Kuha still works.
function loadList(file) {
  try {
    return parseHosts(fs.readFileSync(file, "utf8"));
  } catch {
    return new Set();
  }
}

module.exports = { parseHosts, isBlocked, loadList };
