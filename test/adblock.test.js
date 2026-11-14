const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHosts, isBlocked } = require("../src/adblock");

test("parseHosts reads a hosts file: names only, no comments, no local entries", () => {
  const text = [
    "# Title: a blocklist",
    "",
    "127.0.0.1 localhost",
    "0.0.0.0 0.0.0.0",
    "0.0.0.0 ads.example.com",
    "0.0.0.0 Tracker.Example.NET   # inline comment",
    "plain-domain.example.org",
    "::1 ip6-localhost",
    "0.0.0.0 broadcasthost",
  ].join("\r\n");
  assert.deepEqual([...parseHosts(text)].sort(), ["ads.example.com", "plain-domain.example.org", "tracker.example.net"]);
});

test("parseHosts on empty or missing text gives an empty list", () => {
  assert.equal(parseHosts("").size, 0);
  assert.equal(parseHosts(undefined).size, 0);
});

test("isBlocked matches a listed name and anything under it, but not its parent", () => {
  const list = new Set(["ads.example.com", "doubleclick.net"]);
  assert.equal(isBlocked("ads.example.com", list), true);
  assert.equal(isBlocked("cdn.ads.example.com", list), true);
  assert.equal(isBlocked("AD.DoubleClick.net", list), true);
  assert.equal(isBlocked("doubleclick.net.", list), true);
  assert.equal(isBlocked("example.com", list), false);
  assert.equal(isBlocked("notdoubleclick.net", list), false);
  assert.equal(isBlocked("videos.example.org", list), false);
});

test("isBlocked never matches on a bare top-level name or junk input", () => {
  const list = new Set(["net", "ads.example.com"]);
  assert.equal(isBlocked("anything.net", list), false);
  assert.equal(isBlocked("", list), false);
  assert.equal(isBlocked(undefined, list), false);
  assert.equal(isBlocked("ads.example.com", new Set()), false);
});

test("isBlocked also blocks throwaway ad-network endings, but not normal sites", () => {
  const empty = new Set();
  assert.equal(isBlocked("tort.excuditcycle.cfd", empty), true);
  assert.equal(isBlocked("vinnyvower.cfd", empty), true);
  assert.equal(isBlocked("cuppenbedsore.cyou", empty), true);
  assert.equal(isBlocked("cursive.whorishcropped.rest", empty), true);
  assert.equal(isBlocked("example.com", empty), false);
  assert.equal(isBlocked("9anime.or.at", empty), false);
});

test("isBlocked knows extra ad hosts seen on real pages", () => {
  assert.equal(isBlocked("nd.alfionaupleap.com", new Set()), true);
});
