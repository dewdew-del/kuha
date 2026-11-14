const test = require("node:test");
const assert = require("node:assert/strict");
const { toUrl } = require("../src/address");

test("toUrl: full links open as they are", () => {
  assert.equal(toUrl("  https://a.com/watch?v=1  "), "https://a.com/watch?v=1");
  assert.equal(toUrl("HTTP://a.com/x"), "HTTP://a.com/x");
});

test("toUrl: bare sites get https://", () => {
  assert.equal(toUrl("facebook.com"), "https://facebook.com");
  assert.equal(toUrl("site.com/page?x=1"), "https://site.com/page?x=1");
  assert.equal(toUrl("sub.site.co.uk:8080/a"), "https://sub.site.co.uk:8080/a");
});

test("toUrl: anything else is a DuckDuckGo search", () => {
  assert.equal(toUrl("cute cats"), "https://duckduckgo.com/?q=cute%20cats");
  assert.equal(toUrl("what is node.js"), "https://duckduckgo.com/?q=what%20is%20node.js");
  assert.equal(toUrl("cats"), "https://duckduckgo.com/?q=cats");
});

test("toUrl: other schemes and empty input are refused", () => {
  for (const t of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,hi", "about:blank", "chrome://settings", "", "   ", undefined]) {
    assert.equal(toUrl(t), null, String(t));
  }
});

const { samePage } = require("../src/address");

test("samePage: only the #fragment (or nothing) changed", () => {
  assert.equal(samePage("https://a.com/v?id=1#t=5", "https://a.com/v?id=1#t=9"), true);
  assert.equal(samePage("https://a.com/v", "https://a.com/v"), true);
  assert.equal(samePage("https://a.com/v?id=1", "https://a.com/v?id=2"), false);
  assert.equal(samePage("https://a.com/v", "https://a.com/w"), false);
  assert.equal(samePage("", "https://a.com/"), false);
  assert.equal(samePage("not a url", "not a url"), true);
});

const { sameSite } = require("../src/address");

test("sameSite: same main site name, whatever the subdomain", () => {
  assert.equal(sameSite("https://www.example.com/a", "https://video.example.com/b"), true);
  assert.equal(sameSite("https://example.com/", "http://EXAMPLE.com/x"), true);
  assert.equal(sameSite("https://example.com/", "https://ads-popup.net/win"), false);
  assert.equal(sameSite("https://example.com/", "https://example.com.evil.net/"), false);
  assert.equal(sameSite("https://example.com/", "not a url"), false);
  assert.equal(sameSite("", ""), false);
});
