const test = require("node:test");
const assert = require("node:assert/strict");
const { classify, fromHeaders, createFinds, pageName } = require("../src/sniff");

const MB = 1024 * 1024;
const c = (o) => classify({ statusCode: 200, contentType: "", contentLength: null, ...o });

test("classify: HLS by content type or .m3u8 path", () => {
  assert.equal(c({ url: "https://a.com/x", contentType: "application/vnd.apple.mpegurl" }), "hls");
  assert.equal(c({ url: "https://a.com/x", contentType: "Application/X-MpegURL; charset=utf-8" }), "hls");
  assert.equal(c({ url: "https://a.com/live/master.M3U8?token=1", contentType: "text/plain" }), "hls");
});

test("classify: DASH by content type or .mpd path", () => {
  assert.equal(c({ url: "https://a.com/x", contentType: "application/dash+xml" }), "dash");
  assert.equal(c({ url: "https://a.com/v/manifest.mpd?x=1" }), "dash");
});

test("classify: direct file needs video/ type and 1 MB+, or unknown size with a video extension", () => {
  assert.equal(c({ url: "https://a.com/play", contentType: "video/mp4", contentLength: 5 * MB }), "file");
  assert.equal(c({ url: "https://a.com/play", contentType: "video/webm", contentLength: MB }), "file");
  assert.equal(c({ url: "https://a.com/play", contentType: "video/mp4", contentLength: MB - 1 }), null);
  assert.equal(c({ url: "https://a.com/v.mp4", contentType: "video/mp4" }), "file");
  assert.equal(c({ url: "https://a.com/play", contentType: "video/mp4" }), null);
  assert.equal(c({ url: "https://a.com/v.mp4", contentType: "video/mp4", contentLength: 5 * MB, statusCode: 206 }), "file");
});

test("classify: mislabelled file with a video extension still counts", () => {
  assert.equal(c({ url: "https://a.com/a/clip.MP4", contentType: "application/octet-stream", contentLength: 5 * MB }), "file");
  assert.equal(c({ url: "https://a.com/clip.mkv" }), "file");
  assert.equal(c({ url: "https://a.com/clip.mp4", contentType: "application/octet-stream", contentLength: 1000 }), null);
  assert.equal(c({ url: "https://a.com/download.bin", contentType: "application/octet-stream", contentLength: 5 * MB }), null);
});

test("classify: ignores stream pieces, bad statuses, non-web and junk", () => {
  assert.equal(c({ url: "https://a.com/seg1.ts", contentType: "video/mp2t", contentLength: 5 * MB }), null);
  assert.equal(c({ url: "https://a.com/chunk.m4s", contentType: "video/mp4", contentLength: 5 * MB }), null);
  assert.equal(c({ url: "https://a.com/x.m3u8", statusCode: 404 }), null);
  assert.equal(c({ url: "https://a.com/x.m3u8", statusCode: 302 }), null);
  assert.equal(c({ url: "ftp://a.com/x.mp4", contentType: "video/mp4", contentLength: 5 * MB }), null);
  assert.equal(c({ url: "not a url", contentType: "video/mp4", contentLength: 5 * MB }), null);
  assert.equal(c({ url: "https://a.com/", contentType: "text/html" }), null);
});

test("fromHeaders: any key case, and the full size from Content-Range", () => {
  assert.deepEqual(fromHeaders({ "Content-Type": ["video/mp4"], "Content-Length": ["2048"] }), { contentType: "video/mp4", contentLength: 2048 });
  assert.deepEqual(
    fromHeaders({ "content-type": ["video/mp4"], "content-length": ["65536"], "content-range": ["bytes 0-65535/9000000"] }),
    { contentType: "video/mp4", contentLength: 9000000 }
  );
  assert.equal(fromHeaders({ "content-range": ["bytes 0-1/*"], "content-length": ["2"] }).contentLength, null);
  assert.deepEqual(fromHeaders(undefined), { contentType: "", contentLength: null });
});

test("a 9 MB video fetched 64 KB at a time is still found", () => {
  const h = fromHeaders({ "Content-Type": ["video/mp4"], "Content-Length": ["65536"], "Content-Range": ["bytes 0-65535/9437184"] });
  assert.equal(classify({ url: "https://a.com/play", statusCode: 206, ...h }), "file");
});

test("finds: no duplicates, site entry first, labels, no address leaks to the screen", () => {
  const f = createFinds();
  assert.equal(f.add({ kind: "hls", url: "https://a/1.m3u8" }), true);
  assert.equal(f.add({ kind: "hls", url: "https://a/1.m3u8" }), false);
  f.add({ kind: "file", url: "https://a/v.mp4", sizeBytes: 24 * MB });
  f.add({ kind: "file", url: "https://a/play?id=2" });
  f.add({ kind: "site", url: "https://a/page", title: "Cooking demo" });
  const l = f.list("My Page");
  assert.deepEqual(l.map((x) => [x.kind, x.label, x.sizeBytes]), [
    ["site", "Cooking demo", null],
    ["hls", "My Page (Stream)", null],
    ["file", "My Page (MP4, 24 MB)", 24 * MB],
    ["file", "My Page (Video)", null],
  ]);
  for (const x of l) assert.deepEqual(Object.keys(x).sort(), ["id", "kind", "label", "sizeBytes"]);
  assert.equal(f.get(l[1].id).url, "https://a/1.m3u8");
  assert.equal(f.list("")[1].label, "Video (Stream)");
});

test("finds: a new site entry replaces the old one", () => {
  const f = createFinds();
  f.add({ kind: "site", url: "https://a/1", title: "One" });
  f.add({ kind: "site", url: "https://a/2", title: "Two" });
  assert.deepEqual(f.list("p").map((x) => x.label), ["Two"]);
});

test("finds: clear empties the list and old ids stop working", () => {
  const f = createFinds();
  f.add({ kind: "dash", url: "https://a/1.mpd" });
  const id = f.list("p")[0].id;
  f.clear();
  assert.deepEqual(f.list("p"), []);
  assert.equal(f.get(id), undefined);
  f.add({ kind: "dash", url: "https://a/1.mpd" });
  assert.notEqual(f.list("p")[0].id, id);
});

test("finds: an endless feed stays at 30 entries, newest kept, site entry kept", () => {
  const f = createFinds();
  f.add({ kind: "site", url: "https://a/page", title: "Feed" });
  for (let i = 0; i < 40; i++) f.add({ kind: "hls", url: `https://a/${i}.m3u8` });
  const l = f.list("p");
  assert.equal(l.length, 30);
  assert.equal(l[0].kind, "site");
  assert.equal(f.get(l[29].id).url, "https://a/39.m3u8");
});

test("pageName: real titles pass through, address-like titles become the file or site name", () => {
  assert.equal(pageName("Cooking demo", "https://a.com/watch"), "Cooking demo");
  assert.equal(pageName("a.com/vids/Big%20Buck.mp4", "https://a.com/vids/Big%20Buck.mp4"), "Big Buck");
  assert.equal(pageName("", "https://a.com/"), "a.com");
  assert.equal(pageName("a.com", "https://a.com/"), "a.com");
  assert.equal(pageName("a.com/100%.mp4", "https://a.com/100%.mp4"), "100%");
  assert.equal(pageName("", "not a url"), "Video");
});

test("finds: identical labels are numbered so they can be told apart", () => {
  const f = createFinds();
  f.add({ kind: "hls", url: "https://a/master.m3u8" });
  f.add({ kind: "hls", url: "https://a/720.m3u8" });
  f.add({ kind: "file", url: "https://a/v.mp4" });
  f.add({ kind: "hls", url: "https://a/360.m3u8" });
  assert.deepEqual(f.list("Demo").map((x) => x.label), ["Demo (Stream)", "Demo (Stream 2)", "Demo (MP4)", "Demo (Stream 3)"]);
});
