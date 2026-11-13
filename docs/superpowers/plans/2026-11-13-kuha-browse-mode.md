# Kuha 1.1 Browse Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser inside Kuha that spots videos on any page (direct files, HLS, DASH) and downloads them through the existing download list.

**Architecture:** A locked-down Electron `WebContentsView` sits inside the main window. The main process reads every response that view receives, a pure `classify()` decides if it is a video, and finds are kept in a per-page list. A find is downloaded by handing its address (plus referer, user agent and a file name) to the existing yt-dlp downloader, so queue, progress, cancel and MP3 are reused untouched.

**Tech Stack:** Electron 45 (CommonJS), yt-dlp + ffmpeg (already bundled), `node --test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-kuha-browse-mode-design.md`

## Global Constraints

- No new npm dependencies. Windows x64 only.
- Never attempt to get around DRM. Protected videos get the message `This video is copy-protected (DRM), so it can't be downloaded.` and nothing else.
- The page view has **no preload** and its own session `persist:browse`. A web page must never get `window.kuha`.
- The screen (renderer) passes only a find's `id` to the main process for found videos, never a raw address or headers.
- Only `http:` and `https:` addresses ever load in the page view.
- Kuha's own window keeps its 1.0 lock: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, navigation and new windows denied, the existing Content-Security-Policy.
- Sites yt-dlp already knows must keep working: `buildArgs` called without the new optional fields returns today's arguments plus `--concurrent-fragments 8`.
- **Fast downloads (Dewdew's goal):** every download passes `--concurrent-fragments 8`, so stream pieces (HLS/DASH) arrive 8 at a time instead of one by one.
- **No lag (Dewdew's goal):** the response listener does header checks only (no file or network work); the found list is sent to the screen only when it changes; at most one yt-dlp page lookup is pending per page (800 ms settle time, stale answers dropped); the screen sends `setBounds` at most once per animation frame.
- Footer text `Only download videos you own or have permission to use.` stays visible on every tab.
- Work on a branch named `browse-mode`. Commit messages follow the existing style (`feat: ...`, `fix: ...`, `docs: ...`), with **no Claude/Anthropic attribution of any kind**. Do not push without asking Dewdew. README keeps its download link line near the top.
- Tests run with `npm test` (`node --test "test/**/*.test.js"`).

## Review Focus

Inputs the spec implies but doesn't spell out. Each has a test or check in the task named.

1. **Video sent in pieces (status 206).** Players fetch MP4s in small ranges, so `Content-Length` is the piece, not the file. The real size is the total in `Content-Range`. Expected: a 9 MB video fetched 64 KB at a time is still found. (Task 1)
2. **MP4 served with the wrong label.** Many file hosts send `application/octet-stream` or no content type. Expected: found when the path ends in a video extension. (Task 1)
3. **Page titles that aren't legal file names.** Titles contain `/ \ : * ? " < > |`, `%` (special to yt-dlp's name template), can be empty, or 300 characters long. Expected: the file still saves with a sensible name. (Task 3)
4. **A find clicked after the page moved on.** Expected: the message `That video is no longer on this page.`, not a crash or a wrong download. (Task 1 for the store, Task 4 for the message)
5. **A page that can't be opened** (typo, offline). Expected: a plain message in the page area, not a blank white box. (Task 4 and Task 5, manual check)
6. **An endless feed that never navigates.** Expected: the find list stays at 30 entries at most, newest kept. (Task 1)

## File Structure

| File | Responsibility |
|---|---|
| `src/sniff.js` (new) | Pure: `classify()`, `fromHeaders()`, `createFinds()` |
| `src/address.js` (new) | Pure: `toUrl(text)`, the address-box rule |
| `src/browser.js` (new) | Electron-bound: creates and locks the page view, feeds responses to `sniff.js`, reports state and finds |
| `src/args.js` | `buildArgs` gains optional `referer`, `userAgent`, `title`; new `safeTitle()` |
| `src/errors.js` | DRM message |
| `src/downloader.js` | `start()` passes the optional extras through |
| `main.js` | Bigger window, creates the browser, new IPC handlers |
| `preload.js` | `window.kuha.browse.*`, `window.kuha.downloadFound` |
| `renderer/index.html`, `app.js`, `style.css` | Browse / Batch / Downloads tabs, address bar, found bar |
| `scripts/real-finds.js` (new) | Real-network check of the three find kinds |

---

### Task 1: Spot videos (`src/sniff.js`)

**Files:**
- Create: `src/sniff.js`
- Test: `test/sniff.test.js`

**Interfaces:**
- Produces:
  - `classify({ url, contentType, contentLength, statusCode }) -> "hls" | "dash" | "file" | null`
  - `fromHeaders(responseHeaders) -> { contentType: string, contentLength: number | null }` where `responseHeaders` is Electron's `Record<string, string[]>` (any key case) or `undefined`
  - `createFinds() -> { add(entry) -> boolean, clear(), list(pageTitle) -> [{ id, kind, label, sizeBytes }], get(id) -> entry | undefined }`
    - `add` entry: `{ kind: "site"|"hls"|"dash"|"file", url, sizeBytes?, title? }` (`title` only for `site`)
    - `get` returns the stored entry including `url`

- [ ] **Step 1: Write the failing tests** in `test/sniff.test.js`

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { classify, fromHeaders, createFinds } = require("../src/sniff");

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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/sniff'`

- [ ] **Step 3: Implement `src/sniff.js`**

Decisions the tests don't fully pin:
- `classify` checks in this order: status is 200 or 206; `new URL(url)` parses and is `http:`/`https:`; stream pieces (path ends `.ts` or `.m4s`, or type `video/mp2t`) give `null`; then HLS; then DASH; then file. Content type is lower-cased with anything after `;` dropped. The path is the URL's `pathname`, lower-cased, so query strings never matter.
- Video extensions: `.mp4 .webm .mov .mkv .m4v`.
- File rule: type starts with `video/` and (size >= 1048576, or size unknown and path has a video extension); or type is empty or `application/octet-stream`, path has a video extension, and size is unknown or >= 1048576.
- `fromHeaders`: when `Content-Range` is present, the size is the number after `/` (or `null` when it is `*`); otherwise `Content-Length`; otherwise `null`.
- Labels for non-site finds: `<page title or "Video"> (<detail>)`. Detail is `Stream` for `hls`/`dash`. For `file` it is the upper-cased extension when it is a video extension, else `Video`, followed by `, N MB` when the size is known (`Math.max(1, Math.round(bytes / 1048576))`).
- Ids are strings from one counter that never resets, so an old id can't match a new find.
- Limit 30: when a 31st entry is added, drop the oldest non-site entry.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, all sniff tests green, existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/sniff.js test/sniff.test.js
git commit -m "feat: spot videos in page responses"
```

---

### Task 2: Address-box rule (`src/address.js`)

**Files:**
- Create: `src/address.js`
- Test: `test/address.test.js`

**Interfaces:**
- Produces: `toUrl(text) -> string | null` (`null` means refused)

- [ ] **Step 1: Write the failing tests** in `test/address.test.js`

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/address'`

- [ ] **Step 3: Implement `toUrl(text)` in `src/address.js`**

Order: trim, empty gives `null`. Starts with `http://` or `https://` (any case): return it if `new URL()` parses, else `null`. Starts with any other scheme (`/^[a-z][a-z0-9+.-]*:(?!\d)/i`, the `(?!\d)` keeps `site.com:8080` from looking like a scheme): `null`. Matches a bare site (`/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/`): `"https://" + text`. Otherwise `"https://duckduckgo.com/?q=" + encodeURIComponent(text)`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/address.js test/address.test.js
git commit -m "feat: address box accepts links, sites and search words"
```

---

### Task 3: Download a found address (`args.js`, `errors.js`, `downloader.js`)

**Files:**
- Modify: `src/args.js` (`buildArgs`, new `safeTitle`), `src/errors.js`, `src/downloader.js` (`start`, `run`)
- Test: `test/args.test.js`, `test/errors.test.js`, `test/downloader.test.js`

**Interfaces:**
- Produces:
  - `buildArgs({ url, format, quality, saveDir, ffmpegPath, referer?, userAgent?, title? }) -> string[]`
  - `safeTitle(title) -> string` (exported from `src/args.js`)
  - `downloader.start({ url, format, quality, referer?, userAgent?, title? }) -> id`
  - `cleanError(text)` returns `This video is copy-protected (DRM), so it can't be downloaded.` for DRM errors

- [ ] **Step 1: Write the failing tests**

Add to `test/args.test.js` (also add `safeTitle` to the require line and `const crypto = require("crypto");`):

```js
test("buildArgs without extras adds no referer or user agent", () => {
  const a = buildArgs({ ...base, format: "mp4", quality: "best" });
  assert.ok(!a.includes("--referer"));
  assert.ok(!a.includes("--user-agent"));
});

test("buildArgs always downloads stream pieces 8 at a time", () => {
  for (const format of ["mp4", "mp3"]) {
    const a = buildArgs({ ...base, format, quality: "best" });
    assert.equal(a[a.indexOf("--concurrent-fragments") + 1], "8");
  }
});

test("buildArgs with referer, user agent and title", () => {
  const url = "https://cdn.example.com/v/master.m3u8";
  const a = buildArgs({ ...base, url, format: "mp4", quality: "best", referer: "https://example.com/watch", userAgent: "UA/1", title: "Cooking demo" });
  assert.equal(a[a.indexOf("--referer") + 1], "https://example.com/watch");
  assert.equal(a[a.indexOf("--user-agent") + 1], "UA/1");
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
  assert.equal(a[a.indexOf("-o") + 1], path.join(base.saveDir, `Cooking demo [${hash}].%(ext)s`));
  assert.equal(a[a.length - 1], url);
});

test("safeTitle makes any page title a legal file name", () => {
  assert.equal(safeTitle('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
  assert.equal(safeTitle("100% real\tdeal\n"), "100 real deal");
  assert.equal(safeTitle("  spaced   out.. "), "spaced out");
  assert.equal(safeTitle(""), "video");
  assert.equal(safeTitle(" ... "), "video");
  assert.equal(safeTitle(undefined), "video");
  assert.equal(safeTitle("x".repeat(300)).length, 150);
});
```

Add to `test/errors.test.js` (match the file's existing require and style):

```js
test("cleanError: DRM wins over the login message", () => {
  const msg = "This video is copy-protected (DRM), so it can't be downloaded.";
  assert.equal(cleanError("ERROR: [generic] x: This video is DRM protected"), msg);
  assert.equal(cleanError("ERROR: The requested site is known to use DRM protection. Use --cookies to log in"), msg);
});
```

Add to `test/downloader.test.js`:

```js
test("start passes referer, user agent and title to yt-dlp, and omits them by default", () => {
  const { d, spawnFn } = setup();
  d.start({ url: "https://cdn/x.m3u8", format: "mp4", quality: "best", referer: "https://site/p", userAgent: "UA/1", title: "T" });
  d.start({ url: "https://x/v", format: "mp4", quality: "best" });
  const [a, b] = spawnFn.children.map((ch) => ch.args);
  assert.equal(a[a.indexOf("--referer") + 1], "https://site/p");
  assert.equal(a[a.indexOf("--user-agent") + 1], "UA/1");
  assert.ok(a[a.indexOf("-o") + 1].includes("T ["));
  assert.ok(!b.includes("--referer"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL on the four new tests (`safeTitle is not a function`, missing `--referer`, wrong DRM message).

- [ ] **Step 3: Implement**

- `safeTitle(title)`: replace each of `/ \ : * ? " < > | %` and control characters with a space, collapse runs of whitespace, trim, strip trailing dots and spaces, cut to 150 characters, and return `video` when nothing is left. (`%` goes because it is special in yt-dlp's `-o` template.)
- `buildArgs`: add `--referer <referer>` and `--user-agent <userAgent>` only when given. When `title` is given, the `-o` value is `path.join(saveDir, safeTitle(title) + " [" + first 8 hex of sha1(url) + "].%(ext)s")`; otherwise today's template, unchanged.
- `cleanError`: test `/DRM/i` first, before every other rule.
- `downloader.start`: keep `referer`, `userAgent`, `title` on the job and hand them to `buildArgs` in `run`. The "Already downloading this link." check is unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, including the untouched `buildArgs always` test.

- [ ] **Step 5: Commit**

```bash
git add src/args.js src/errors.js src/downloader.js test/args.test.js test/errors.test.js test/downloader.test.js
git commit -m "feat: download found addresses with referer and a page-title file name"
```

---

### Task 4: The page view and its wiring (`src/browser.js`, `main.js`, `preload.js`)

**Files:**
- Create: `src/browser.js`
- Modify: `main.js`, `preload.js`

**Interfaces:**
- Consumes: `classify`, `fromHeaders`, `createFinds` (Task 1); `toUrl` (Task 2); `downloader.start` with extras, `downloader.getInfo` (Task 3)
- Produces:
  - `createBrowser({ win, getInfo, onState, onFound }) -> { go(url), back(), forward(), reload(), stop(), setBounds(rect), setVisible(bool), getFind(id) }`
    - `onState({ url, title, loading, canGoBack, canGoForward, error })`, `error` is a string or `null`
    - `onFound([{ id, kind, label, sizeBytes }])`
    - `getFind(id) -> { kind, url, referer, userAgent, title } | undefined`
  - IPC (all through the existing `handle()` wrapper): `kuha:browseGo(text)`, `kuha:browseBack`, `kuha:browseForward`, `kuha:browseReload`, `kuha:browseStop`, `kuha:browseSetBounds({x, y, width, height})`, `kuha:browseSetVisible(bool)`, `kuha:downloadFound({id, format, quality}) -> job id`
  - Events to the window: `kuha:browseState`, `kuha:found`
  - `window.kuha.browse = { go, back, forward, reload, stop, setBounds, setVisible, onState(cb), onFound(cb) }` and `window.kuha.downloadFound(opts)`; `onState`/`onFound` return an unsubscribe function like `onProgress` does

- [ ] **Step 1: Implement `src/browser.js`**

Electron choices to follow exactly:
- Session: `session.fromPartition("persist:browse")`.
- User agent: take the session's default and remove the app and Electron tokens (`/\s(?:kuha|Electron)\/\S+/gi`), then `ses.setUserAgent(clean)`. Sites treat an "Electron" browser oddly, and the same string is sent with downloads.
- Refuse everything: `ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))`, `ses.setPermissionCheckHandler(() => false)`, `ses.on("will-download", (e) => e.preventDefault())`.
- View: `new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } })`, no `preload`. Add with `win.contentView.addChildView(view)` and start hidden (`view.setVisible(false)`).
- New windows: `setWindowOpenHandler(({ url }) => { /* load url in this same view when it is http(s) */ return { action: "deny" }; })`.
- `will-navigate` and `will-redirect`: `preventDefault()` unless the target is `http:` or `https:`.
- Sniffing: `ses.webRequest.onResponseStarted((d) => ...)`. Skip when `d.webContentsId !== view.webContents.id`. Feed `fromHeaders(d.responseHeaders)` plus `d.url` and `d.statusCode` to `classify`; on a hit, `finds.add({ kind, url: d.url, sizeBytes })` and, when it returns `true`, call `onFound(finds.list(title))`.
- Page changes (`did-navigate`, and `did-navigate-in-page` when `isMainFrame`): `finds.clear()`, send found and state, then after 800 ms of no further change call `getInfo(pageUrl)`. When it resolves and `view.webContents.getURL()` is still that address, `finds.add({ kind: "site", url: pageUrl, title: info.title })` and send found. A rejected lookup is ignored.
- State is sent on `did-start-loading`, `did-stop-loading`, `page-title-updated`, and the two navigate events. Use `view.webContents.navigationHistory.canGoBack()` / `canGoForward()`.
- `did-fail-load` for the main frame, except error code `-3` (cancelled): send state with `error: "Couldn't open this page. Check the address and your internet."`. Any later successful navigation sends `error: null`.
- `go(url)` refuses anything that is not `http:`/`https:` (throws `That address can't be opened.`) and calls `view.webContents.loadURL(url)`, swallowing the rejected promise (the failure arrives through `did-fail-load`).
- `setBounds` rounds the four numbers and ignores anything that isn't a finite number. `setVisible(b)` calls `view.setVisible(!!b)`.
- `getFind(id)`: for a `site` find return `{ kind, url }`; otherwise add `referer` (the current page address), `userAgent` (`ses.getUserAgent()`), `title` (the current page title).

- [ ] **Step 2: Wire `main.js`**

- Window opens at `width: 1100, height: 760` (minimums unchanged).
- After `createWindow()`, create the browser with `getInfo: (u) => downloader.getInfo(u)` and `onState` / `onFound` that `win.webContents.send("kuha:browseState" | "kuha:found", data)` when the window still exists.
- `browseGo(text)`: `const url = toUrl(String(text))`; when `null`, throw `That address can't be opened.`; else `browser.go(url)`.
- `downloadFound({ id, format, quality })`: same tool and save-folder checks as `download` (move those checks into one shared local function used by both). `const f = browser.getFind(String(id))`; when missing, throw `That video is no longer on this page.`. Start the job with `f.url` and, for non-site finds, `f.referer`, `f.userAgent`, `f.title`. Format and quality are cleaned exactly as `download` does.
- The other handlers call straight through to the browser.

- [ ] **Step 3: Extend `preload.js`** with the `browse` object and `downloadFound`, following the existing `call()` and `onProgress` patterns.

- [ ] **Step 4: Check nothing regressed**

Run: `npm test`
Expected: PASS (no new unit tests; this task is Electron-bound).

- [ ] **Step 5: Manual check through the DevTools console**

Run: `npm start`, press `Ctrl+Shift+I` in the Kuha window, and in the Console run each line:

```js
kuha.browse.onState((s) => console.log("state", s)); kuha.browse.onFound((l) => console.log("found", l));
await kuha.browse.setBounds({ x: 0, y: 300, width: 900, height: 400 }); await kuha.browse.setVisible(true);
await kuha.browse.go("https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4");
```

Expected:
- The video shows in the lower part of the window, `state` logs arrive, and a `found` log lists one `file` entry labelled like `... (MP4, 5 MB)` with no `url` field.
- `await kuha.downloadFound({ id: "<that id>", format: "mp4", quality: "best" })` returns an id and the file appears in `Downloads\Kuha`.
- `await kuha.browse.go("https://this-site-does-not-exist.invalid")` logs a state with the `Couldn't open this page` error.
- `await kuha.browse.go("file:///C:/Windows/win.ini")` throws `That address can't be opened.`
- `await kuha.downloadFound({ id: "999999", format: "mp4", quality: "best" })` throws `That video is no longer on this page.`
- Read `src/browser.js` once more and confirm the view's `webPreferences` has no `preload` key, so a web page can never get `window.kuha`.

- [ ] **Step 6: Commit**

```bash
git add src/browser.js main.js preload.js
git commit -m "feat: locked-down page view that reports found videos"
```

---

### Task 5: The screen (`renderer/`)

**Files:**
- Modify: `renderer/index.html`, `renderer/app.js`, `renderer/style.css`

**Interfaces:**
- Consumes: `window.kuha.browse.*`, `window.kuha.downloadFound` (Task 4); existing `window.kuha` methods

- [ ] **Step 1: Restructure `renderer/index.html`**

- Header line becomes `Open any page with a video. Get MP4 or MP3.`
- Tabs, in order: `Browse` (`data-tab="browse"`, on by default), `Batch` (`data-tab="batch"`), `Downloads` (`data-tab="downloads"`) with a count element `#dlCount` inside it.
- `#browse` section, top to bottom:
  - Address row: buttons `#back` (←), `#fwd` (→), `#reload` (⟳, shows ✕ while loading), input `#addr` (`type="text"`, placeholder `Paste a video link or type a site`, `spellcheck="false"`, `autocomplete="off"`), button `#goAddr` (`Go`). Every icon button has an `aria-label`.
  - `#pageArea`: an empty box the page view is laid over. It contains `#hint` (`Paste a video link or type a site, then press play.`) and `#pageError` (hidden, `role="alert"`).
  - `#found` (hidden, `aria-live="polite"`): the text `Video found:`, a `select#foundPick`, a format toggle, a quality select, button `#dlFound` (`Download`).
- `#batch` section: the existing textarea plus its own format toggle, quality select and `#go` button.
- `#downloads` section: the existing save bar, an empty-state line `#noDownloads` (`No downloads yet.`), and `ul#list`.
- The two format toggles keep class `seg`; the two quality selects use class `quality` (the `#quality` id is removed). Both pairs always show the same value.
- Remove `#single`, `#link`, `#paste`, `#preview`, `#pstatus`, `#listTitle`.
- Footer and the Settings dialog are unchanged.

- [ ] **Step 2: Rewrite the affected parts of `renderer/app.js`**

- Remove the single-link code (`singleInfo`, `loadPreview`, the `#link` and `#paste` listeners, `setStatus`, `isUrl`).
- `mode` is `browse | batch | downloads`. Switching tabs shows one section.
- Format and quality: one `format` and one quality value; `setFormat` and a new `setQuality` update every `.seg` and every `select.quality`, and save through `kuha.setSettings` as today.
- Address bar: `Go` click or Enter in `#addr` calls `kuha.browse.go(text)`; a thrown error shows in `#pageError`. `#back`, `#fwd` call through. `#reload` calls `stop()` while loading, else `reload()`.
- `kuha.browse.onState`: remember the state; set `#addr` to the address unless the box has focus; enable/disable `#back` and `#fwd`; switch `#reload` between ⟳ and ✕; show `state.error` in `#pageError` or hide it.
- Page view placement: one function `placeView()` that calls `kuha.browse.setVisible(visible)` where `visible` is: on the Browse tab, and a page has been opened, and there is no error, and the Settings dialog is closed. When visible it also calls `kuha.browse.setBounds()` with `#pageArea`'s `getBoundingClientRect()` (x, y, width, height). Call it from a `ResizeObserver` on `#pageArea`, on tab switch, on every state update, when Settings opens, and on the dialog's `close` event.
- `kuha.browse.onFound(list)`: hide `#found` when empty. Otherwise fill `#foundPick` with one option per find (`value` = id, text = label), keeping the current pick when it is still in the list and otherwise picking the first. Call `placeView()` afterwards, since showing the bar shrinks `#pageArea`.
- `#dlFound` click: `kuha.downloadFound({ id, format, quality })`, then add a card titled with the picked label using the existing `card()` / `cards` / cancel wiring. Errors go through the existing `fail()` path, including the "Choose another one" folder prompt. The tab does not switch.
- Batch download keeps its current behaviour.
- `#dlCount` shows the number of jobs whose last status is `queued`, `downloading` or `converting`, and is empty at zero. `#noDownloads` is hidden once any card exists.

- [ ] **Step 3: Update `renderer/style.css`**

The window becomes a full-height column: header, warning, tabs, the active section, footer. On the Browse tab `#pageArea` takes all the spare height (`flex: 1`, `min-height: 0`) and the found bar sits under it. Batch and Downloads scroll inside their section. Keep the existing dark colours, buttons and spacing; no new fonts or colours.

- [ ] **Step 4: Check nothing regressed**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Manual check**

Run: `npm start`. Expected, in order:
1. Kuha opens on Browse with the hint text and no found bar.
2. Type `example.com`, press Enter: the page fills the area between the address row and the footer, and the address box shows `https://example.com/`.
3. Resize the window: the page follows, with no gap and no overlap on the address row or footer.
4. Paste `https://www.youtube.com/watch?v=jNQXAC9IVRw` and press Go: within a few seconds the bar shows `Video found:` with the video's real title first in the list.
5. Click Download: the Downloads tab shows `1`, the page stays where it is, and the Downloads tab shows the card progressing to `saved` with Open and Show in folder.
6. Open Settings while a page is showing: the dialog is fully visible (the page hides) and the page returns when it closes.
7. Type `this-site-does-not-exist.invalid`: the page area shows the "Couldn't open this page" message, not a blank box.
8. Type `cute cats`: a DuckDuckGo results page opens.
9. Batch tab: paste two links, `Download 2 links` works as in 1.0.
10. Tab through the Browse controls with the keyboard: every control is reachable and has a visible focus ring.

- [ ] **Step 6: Commit**

```bash
git add renderer/index.html renderer/app.js renderer/style.css
git commit -m "feat: Browse, Batch and Downloads tabs with the found bar"
```

---

### Task 6: Real-page checks (`scripts/real-finds.js`)

**Files:**
- Create: `scripts/real-finds.js`

**Interfaces:**
- Consumes: `createDownloader` with the Task 3 extras

- [ ] **Step 1: Write `scripts/real-finds.js`**, modelled on `scripts/real-links.js` (same vendor paths, temp save folder, quality `360`). It starts one job per row with `referer`, `userAgent: "Mozilla/5.0"` and `title` set, as a find would:

| Name | Address | Referer | Passes when |
|---|---|---|---|
| Direct MP4 | `https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4` | `https://test-videos.co.uk/` | status `done` and the file exists |
| HLS | `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` | `https://hls-js.netlify.app/` | progress reaches 3%, then the script cancels it |
| DASH | `https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd` | `https://reference.dashif.org/` | progress reaches 3%, then the script cancels it |

The streams are ten-minute videos, so reaching 3% proves the stream list was read and pieces are arriving without downloading it all. Print `OK` / `FAIL <name>: <error>` per row and exit non-zero on any failure.

- [ ] **Step 2: Run it**

Run: `node scripts/real-finds.js`
Expected: `3/3 OK`. If a test address is gone (404), replace that row with another public test file of the same kind and note the swap in the commit message.

- [ ] **Step 3: Manual sniff check in the app** (`npm start`, Browse tab)

| Open | Do | Expected in the bar |
|---|---|---|
| The Direct MP4 address above | nothing | one entry ending `(MP4, 5 MB)` |
| `https://hls-js.netlify.app/demo/` | press play | an entry ending `(Stream)`; Download saves a playable MP4 |
| `https://reference.dashif.org/dash.js/latest/samples/dash-if-reference-player/index.html` | press Load, then play | an entry ending `(Stream)`; Download saves a playable MP4 |
| A public Facebook video | wait | the video's real title first in the list |

Also confirm one MP3 download from a found stream, and that going to a new page clears the bar.

- [ ] **Step 4: Commit**

```bash
git add scripts/real-finds.js
git commit -m "test: real-network check for found videos"
```

---

### Task 7: Release 1.1.0

**Files:**
- Modify: `package.json` (version), `README.md`

- [ ] **Step 1:** Run `npm version 1.1.0 --no-git-tag-version` (updates `package.json` and `package-lock.json` together), then change `description` in `package.json` to `Kuha - find and download videos as MP4 or MP3`.

- [ ] **Step 2: Update `README.md`**
- Keep the download link line near the top and point it at the 1.1.0 release once it exists.
- Add a short **Browse mode** section: open a page, press play, click Download.
- Add **What it can't do**, in plain words, from spec section 8: no DRM sites (Netflix, Disney+, Spotify, Viu), login-only videos may fail, some players can't be caught, ads show up in the list.
- Replace the main screenshot with one of the Browse tab showing the found bar, following the README's existing image convention.

- [ ] **Step 3: Build and install**

Run: `npm run fetch-tools` then `npm run dist`
Expected: `dist\Kuha-Setup-1.1.0.exe` exists.

Install it, then check in the installed app: one find of each kind from Task 6 Step 3, one MP3, Batch with two links, the Start Menu shortcut, and uninstall.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json README.md
git commit -m "docs: Kuha 1.1.0 with Browse mode"
```

- [ ] **Step 5:** Stop and ask Dewdew before pushing, merging `browse-mode` into `main`, or creating the GitHub release.
