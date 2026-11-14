const test = require("node:test");
const assert = require("node:assert/strict");
const { matchShortcut, fmtTime, hostOf } = require("../renderer/ui");

const key = (k, mods = {}) => matchShortcut({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("matchShortcut maps the browser keys", () => {
  assert.equal(key("l", { ctrlKey: true }), "address");
  assert.equal(key("L", { ctrlKey: true }), "address"); // caps lock
  assert.equal(key("ArrowLeft", { altKey: true }), "back");
  assert.equal(key("ArrowRight", { altKey: true }), "forward");
  assert.equal(key("F5"), "reload");
  assert.equal(key("r", { ctrlKey: true }), "reload");
  assert.equal(key("R", { ctrlKey: true, shiftKey: true }), "reload");
  assert.equal(key("Escape"), "escape");
});

test("matchShortcut ignores everything else, including near misses", () => {
  assert.equal(key("l"), null);
  assert.equal(key("r"), null);
  assert.equal(key("ArrowLeft"), null); // plain arrows belong to text boxes
  assert.equal(key("ArrowLeft", { altKey: true, ctrlKey: true }), null);
  assert.equal(key("l", { ctrlKey: true, altKey: true }), null); // AltGr on some layouts
  assert.equal(key("a", { ctrlKey: true }), null);
});

test("fmtTime shows m:ss and h:mm:ss, and nothing for no duration", () => {
  assert.equal(fmtTime(0), "");
  assert.equal(fmtTime(undefined), "");
  assert.equal(fmtTime(65), "1:05");
  assert.equal(fmtTime(3725), "1:02:05");
});

test("hostOf gives the site name without www, or empty for junk", () => {
  assert.equal(hostOf("https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(hostOf("https://video.example.com/x"), "video.example.com");
  assert.equal(hostOf(""), "");
  assert.equal(hostOf("not a url"), "");
});
