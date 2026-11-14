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

// Endings that ad networks rotate through with random-looking names (a new one every week), so
// no list keeps up. Almost no real site lives on them.
// shortcut: a real site on one of these is blocked as a sub-resource; remove its ending here.
const THROWAWAY = new Set(["cfd", "cyou", "rest", "sbs", "icu", "buzz", "monster", "quest", "bond"]);

// Whole name parts that mean "ad network": pop-under, banner and video-ad sellers, native-ad widgets.
const AD_LABELS = new Set([
  "ads", "adserver", "adservice", "adsystem", "adx", "banners", "popads", "popcash", "popunder", "doubleclick",
  "exoclick", "juicyads", "adsterra", "propellerads", "clickadu", "hilltopads", "trafficjunky", "trafficfactory",
  "taboola", "outbrain", "revcontent", "mgid", "adnxs", "pubmatic", "criteo", "onclickads", "adcash", "adskeeper",
  "googlesyndication", "googleadservices", "smartadserver", "adform", "yllix", "richpush", "pushails",
]);

// Ad scripts and frames give themselves away in their address.
const AD_PATH = /\/(?:adserver|ad-server|adframe|popunder|pop-under|prebid|pagead|show_ads|adsbygoogle|ads\.js|ad\.js|popads?|banner-ads?)\b/i;
function isAdPath(url) {
  try {
    return AD_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// Ad hosts seen on real pages that the downloaded list doesn't have yet.
const EXTRA = new Set(["alfionaupleap.com"]);

// True when the name, or a parent of it, is on the list. Stops before the last label,
// so a stray "net" on a list can never block every .net site.
function isBlocked(hostname, list) {
  let name = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  if (THROWAWAY.has(name.slice(name.lastIndexOf(".") + 1))) return true;
  if (name.split(".").some((l) => AD_LABELS.has(l))) return true;
  while (name.includes(".")) {
    if (list.has(name) || EXTRA.has(name)) return true;
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

module.exports = { parseHosts, isBlocked, isAdPath, loadList };
