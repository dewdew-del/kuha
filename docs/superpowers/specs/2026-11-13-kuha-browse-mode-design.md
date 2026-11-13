# Kuha 1.1: Browse mode (find videos on any site)

Date: 2026-11-13
Status: Draft, waiting for Dewdew's review
Builds on: `2026-11-06-kuha-desktop-design.md` (Kuha 1.0.0)

## 1. Goal

Make Kuha work like Internet Download Manager: you open a page, play the video, and Kuha offers to download it. It should work on sites yt-dlp has never heard of.

- **Dewdew said:** "I want Kuha to be like IDM, where it can download all video." Pasting a link stays, but it's optional now, one of two ways to use the same box. The browser lives inside Kuha (chosen over a Chrome extension).
- **Success:** someone opens Kuha, types or pastes any site with a normal (unprotected) video, presses play, sees "Video found", clicks Download, and the file lands in `Downloads\Kuha`.

## 2. Goals, non-goals, anti-goals

**Goals**
- One box that takes a pasted video link or a site address.
- A browser inside the Kuha window. Kuha watches what the page loads and spots videos.
- Three kinds of video are detected: direct files (MP4, WebM and similar), HLS streams (`.m3u8`), DASH streams (`.mpd`).
- Sites yt-dlp already knows (YouTube, TikTok, Facebook...) keep working as well as today, from the same box.
- Found videos download through the existing list: progress, Cancel, Open, Show in folder, MP4/MP3.
- Batch download stays as it is.

**Non-goals (not in 1.1)**
- A Chrome/Edge extension. Possible later; the download code would be shared.
- Tabs, bookmarks, history, or anything that makes it a full browser.
- Sending the site's login cookies to the downloader (see section 8).
- Mac/Linux, app auto-update, playlists. Same as 1.0.

**Anti-goals (would make this a failure even if it works)**
- Breaking or getting around DRM (Netflix, Disney+, Spotify, Viu and the like). Never. Protected videos get a clear message and nothing else.
- A web page being able to reach Kuha's own controls, files, or the user's PC.
- Losing what works today for YouTube/TikTok/Facebook links.

## 3. Approaches

**Where Kuha watches for videos** (Dewdew picked):

| | Browser inside Kuha (picked) | Chrome/Edge extension |
|---|---|---|
| Setup for users | One installer, nothing else | Install Kuha, then the extension by hand |
| Cost | Free | Chrome store fee, and it rejects YouTube downloaders |
| Logins | Sign in again inside Kuha | Reuses existing logins |
| Work | Medium | Large |

Picked the built-in browser: free, one installer, no extra steps for users.

**How a found video gets downloaded** (Claude's call, Dewdew left the how to me):

| | Hand the found address to yt-dlp (picked) | Call ffmpeg directly | Write our own stream downloader |
|---|---|---|---|
| New code | Very little: yt-dlp already downloads direct files, `.m3u8` and `.mpd` | New progress reading, new cancel cleanup | A lot, and the hardest to get right |
| Progress / cancel / MP3 / quality | All reused as-is | Rebuilt | Rebuilt |

Picked yt-dlp: the whole download list keeps working with almost no new code.

## 4. How it works for the user

```
┌─ Kuha ───────────────────────────────────────────────────┐
│ Kuha            [ Browse ] [ Batch ] [ Downloads (2) ]  ⚙ │
├──────────────────────────────────────────────────────────┤
│ [←][→][⟳] [ paste a link or type a site           ] [Go] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                 (the website shows here)                 │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ⬇ Video found: Cooking demo  [MP4|MP3] [720p ▾] [Download]│
└──────────────────────────────────────────────────────────┘
```

1. Kuha opens on the **Browse** tab with an empty page and a short hint ("Paste a video link or type a site, then press play").
2. The user pastes a link or types a site and presses Go (or Enter). The page opens inside Kuha.
3. Kuha looks for videos two ways at the same time:
   - **It asks yt-dlp about the page address.** If yt-dlp knows the site, the bar shows the video's real title. This is the best-quality path.
   - **It watches what the page loads.** When the video starts playing, the bar shows what it caught.
4. The bar at the bottom appears as soon as either one finds something. If there's more than one video (ads count too), the bar shows a small list to pick from, with yt-dlp's result first.
5. Download adds it to the **Downloads** tab, which shows a count of running downloads.
6. When the user goes to another page, the bar clears and starts again.

On the watching path the user usually has to press play first. Kuha can only see a video once the site starts sending it.

## 5. Architecture

New and changed files:

```
src/sniff.js     NEW. Pure functions: is this response a video? what kind? Plus the per-page list of finds.
src/browser.js   NEW. Creates the page view, locks it down, reports navigation and finds.
src/args.js      buildArgs accepts optional referer, userAgent, title.
src/errors.js    New message for protected (DRM) videos.
src/downloader.js  start() accepts the optional extras and passes them through.
main.js          New IPC handlers; sizes the page view to fit the window.
preload.js       New window.kuha methods (below).
renderer/        New tab layout, address bar, found bar, Downloads tab.
```

**The page view.** An Electron `WebContentsView` added to the main window, placed between the address bar and the found bar. It is a separate layer on top of Kuha's own screen, so Kuha's menus and the Settings dialog can't draw over it: the view is hidden whenever the user is on another tab or Settings is open.

**New `window.kuha` methods**
- `browse.go(text)`, `browse.back()`, `browse.forward()`, `browse.reload()`, `browse.stop()`
- `browse.setBounds({x, y, width, height})`, `browse.setVisible(bool)`
- `browse.onState(cb)` sends `{url, title, loading, canGoBack, canGoForward, error}`. `error` is a plain message when a page can't be opened (typo, offline), otherwise empty
- `browse.onFound(cb)` sends the current list: `[{id, kind: site|file|hls|dash, label, sizeBytes}]`
- `downloadFound({id, format, quality})` gives a job id

The screen only ever passes a find's `id`. The main process looks up the real address, referer and user agent itself. The screen never hands raw addresses or headers to the downloader for found videos.

**What `browse.go(text)` does with the text**
- Starts with `http://` or `https://`: open it.
- Looks like a site (`facebook.com`, `site.com/page`): add `https://` and open it.
- Anything else: search for it on DuckDuckGo.
- Only `http` and `https` ever load. Everything else (`file:`, `javascript:` and so on) is refused.

## 6. Spotting videos (`src/sniff.js`)

The main process listens to every response the page view receives and passes `{url, contentType, contentLength, statusCode}` to a pure `classify()` function.

| Kind | Counts when |
|---|---|
| `hls` | Content type is `application/vnd.apple.mpegurl` or `application/x-mpegurl`, or the path ends in `.m3u8` |
| `dash` | Content type is `application/dash+xml`, or the path ends in `.mpd` |
| `file` | Content type starts with `video/` (but not `video/mp2t`), and the size is 1 MB or more, or unknown with a path ending in `.mp4`, `.webm`, `.mov`, `.mkv` or `.m4v`. Also counts when the content type is missing or `application/octet-stream` and the path ends in one of those extensions (size 1 MB or more, or unknown), because many file hosts label videos that way |

Ignored: stream pieces (`.ts`, `.m4s`, `video/mp2t`, and `video/` responses under 1 MB), and anything that isn't a 200 or 206 response.

Size means the whole file. Players often fetch a video in small pieces, so when the response says which piece of how many bytes it is (`Content-Range`), the total is used, not the piece.

Per page:
- Finds are kept in a list, one entry per address (no duplicates), newest last, 30 at most (the oldest drops off, so an endless feed can't grow the list forever).
- The list is cleared when the main page navigates somewhere new.
- Each time the page address changes, yt-dlp is asked about it (the existing `getInfo`, which already limits how many run at once). If it answers, a `site` entry goes to the top of the list with the video's title. Fast repeated changes only trigger one lookup, for the last address.
- Labels: `site` uses yt-dlp's title. Others use the page title plus the kind ("Stream" or "MP4, 24 MB").

A stream often shows up as several `.m3u8` addresses (one master list plus one per quality). All are listed in the order seen; the first is the default pick, since sites load the master list first.

## 7. Downloading a find

- `site` finds: exactly today's download, using the page address.
- `file`, `hls`, `dash` finds: today's download using the found address, plus:
  - `--referer <page address>` and `--user-agent <the page view's user agent>`. Many sites refuse a video request that doesn't come from their own page.
  - The file is named after the page title: `<page title> [<8-character hash of the address>].<ext>`. The hash keeps two videos from the same page apart, the same reason 1.0 added the video id.
- Speed: every download (found or pasted) fetches stream pieces 8 at a time (`--concurrent-fragments 8`). A direct single file still downloads over one connection; splitting those would need an extra bundled tool (aria2c) and is left for later.
- MP4/MP3 and the quality choice work the same. For a direct file the quality choice has no effect (there's only one).
- The "Already downloading this link" check from 1.0 applies to finds too.

## 8. Limits to state plainly

- **Protected (DRM) videos never download.** The Electron build Kuha uses has no DRM player, so these sites mostly won't even play inside Kuha. If a protected stream is found anyway and yt-dlp refuses it, the user sees: "This video is copy-protected (DRM), so it can't be downloaded."
- **Videos behind a login may fail on the watching path.** 1.1 sends the page address and browser name with the download, but not the site's login cookies. Many sites put a one-time key in the video address itself, so they work anyway. Sending cookies is the first upgrade to consider if this turns out to matter.
- **Some players can't be caught.** A site that feeds the player in tiny hidden pieces with no stream list, and that yt-dlp doesn't know, gives Kuha nothing to grab. The bar simply doesn't appear.
- **Ads get detected too.** They show up in the list; the user picks the right one.

## 9. Safety of the page view

Kuha will now load any website, so the page view is locked down separately from Kuha's own screen:

- Its own storage (`persist:browse`), so site logins survive a restart but are kept apart from Kuha's screen.
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and **no preload**: a web page gets no `window.kuha` and no way to talk to Kuha.
- Every permission request is refused (camera, microphone, location, notifications and the rest).
- Downloads started by a page are cancelled. Only Kuha's own Download button saves files.
- Pop-ups don't open new windows. A link that wants a new window opens in the same view instead.
- Only `http`/`https` navigation is allowed.
- Kuha's own screen keeps its 1.0 lock (can't navigate, can't open windows, strict content policy).

## 10. Screen changes

- Tabs become **Browse** (default), **Batch**, **Downloads**. The old "Single link" tab is gone; its box is now the address bar.
- Window opens at 1100×760 (was 900×680) so a web page has room. Minimum stays 640×560.
- The header line changes to "Open any page with a video. Get MP4 or MP3."
- Batch keeps its textarea, format, quality and Download button.
- Downloads holds the existing list and the "Saving to" bar. Starting a download does not switch tabs; the count on the tab goes up.
- Settings (default format and quality, versions, Update yt-dlp) is unchanged.
- The footer line "Only download videos you own or have permission to use." stays visible on every tab.

## 11. Testing

- **Unit (`node --test`):**
  - `classify()`: each row of the table in section 6, the ignored cases, and odd inputs (missing content type, query strings after `.m3u8`, upper-case extensions).
  - The per-page list: no duplicates, cleared on navigation, `site` entry first.
  - `buildArgs` with referer, user agent and title; and without them it gives exactly today's output.
  - The address-box rule in section 5 (link, bare site, search words, refused schemes).
  - `cleanError` for the DRM message.
- **Real pages (manual script, like `scripts/real-links.js`):** one public page each for a direct MP4, an HLS stream and a DASH stream, plus YouTube and Facebook through Browse.
- **Installer:** build `Kuha-Setup-1.1.0.exe`, install, run one find of each kind and one MP3, check Batch still works.

## 12. Release

- Version 1.1.0. README: new screenshot, a short "Browse mode" section, and the limits from section 8 in plain words.
- `D:\dev\CLAUDE.md` and `project-ideas.md` status lines are updated when Dewdew says so.

## 13. Left to the builder

- Exact look of the address bar, found bar and tab count (keep the 1.0 dark style).
- How lookups for fast-changing page addresses are held back (any simple delay works).
- Whether the found bar's list is a dropdown or an expanding panel.
- Internal names and how `browser.js` and `main.js` split the work.

## 14. Calls Claude made (check these)

1. **The page always opens, even for sites yt-dlp knows.** Earlier I said known links would show a preview without loading the page. There is no quick way to know if yt-dlp recognises a link (the check takes a few seconds), so loading the page right away avoids staring at a spinner. The yt-dlp result still appears in the bar with the real title.
2. **A separate Downloads tab**, because the web page needs the room the list used to take.
3. **Bigger default window** (1100×760).
4. **Typed words that aren't a site go to a DuckDuckGo search.**
5. **No login cookies sent to the downloader in 1.1** (section 8).
6. **Videos under 1 MB are ignored** to cut out stream pieces and tiny ad clips.
