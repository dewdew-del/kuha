# Kuha

**Download for Windows:** https://github.com/dewdew-del/kuha/releases/latest

> Windows 10/11, 64-bit. The installer is about 234 MB because yt-dlp and FFmpeg come bundled, so there's nothing else to install.

Kuha ("to get" in Bisaya and Tagalog) is a desktop app that saves videos from the internet as **MP4** or **MP3**. Open a page inside Kuha, press play, and it offers to download the video. There's also a batch mode for many links at once.

Built with Electron, powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org/).

## Features
- **Browse mode**: a browser inside Kuha that spots videos on the page you're watching
- **One box for everything**: paste a video link, type a site, or type words to search
- **Batch download**: paste many links, one per line. Duplicates and non-links are skipped, and up to 3 download at a time
- **MP4** (360p up to best quality) or **MP3** (best audio quality)
- **Fast streams**: stream pieces are fetched 8 at a time
- Saves straight to `Downloads\Kuha`, or any folder you choose
- **Cancel** any download. Half-finished files are cleaned up
- **Open** and **Show in folder** buttons on every finished download
- yt-dlp updates itself on launch, so sites keep working
- Plain-English error messages (private video, copy-protected video, no sound for MP3, site not readable)

## Browse mode
1. Paste a link or type a site in the box at the top, then press **Go**.
2. Press play on the video.
3. A **Video found** bar appears at the bottom. Pick MP4 or MP3 and click **Download**.

Kuha finds videos two ways at once. It asks yt-dlp about the page, which gives the best quality on the sites yt-dlp knows (YouTube, TikTok, Facebook and many more). It also watches what the page loads, which catches plain video files and streams (HLS `.m3u8`, DASH `.mpd`) on sites yt-dlp has never heard of.

Web pages are kept apart from the rest of the app: they can't use your camera, microphone or location, can't open pop-up windows, and can't save files on their own.

### What it can't do
- **Paid streaming with DRM** (Netflix, Disney+, Spotify, Viu and similar). Not supported, ever. Kuha does not try to get around copy protection.
- **Videos behind a login** may fail when they're caught from the page, because Kuha doesn't pass your login to the downloader.
- **Some players can't be caught.** If a site feeds its player in a way that leaves no file or stream address, and yt-dlp doesn't know the site, no bar appears.
- **Ads get found too.** If the bar lists more than one video, pick the one you want.
- **Small clips are skipped.** Video files under 1 MB are ignored to keep stream pieces and tiny ads out of the list.

## Tested sites
| Site | MP4 | MP3 |
|---|---|---|
| YouTube (videos + Shorts) | ✅ | ✅ |
| TikTok | ✅ | ✅ |
| X / Twitter (posts with a video) | ✅ | ✅ |
| Instagram | ✅ | ✅ (if the video has sound) |
| Facebook (videos + reels) | ✅ | ✅ |
| Dailymotion | ✅ | ✅ |
| Pages with a plain MP4, HLS or DASH video | ✅ | ✅ (if the video has sound) |
| Vimeo, Reddit | ❌ need a login | ❌ |

yt-dlp supports many more sites.

## Installing: "Windows protected your PC"
Kuha isn't code-signed (a certificate costs money), so the first time you run the installer Windows SmartScreen may show a blue **"Windows protected your PC"** box. Click **More info**, then **Run anyway**. This is normal for free apps from small developers.

## Why a desktop app
Video sites like YouTube block downloads that come from cloud servers (Vercel, Render and others). Kuha runs on your own PC and uses your home internet, so downloads work, and there's no server to host or pay for.

## Build from source
Requires [Node.js](https://nodejs.org/) 18 or newer, on Windows.

```powershell
git clone https://github.com/dewdew-del/kuha.git
cd kuha
npm install
npm run fetch-tools   # downloads yt-dlp, ffmpeg and ffprobe into .\vendor
npm start             # run the app
npm test              # unit tests
npm run dist          # build dist\Kuha-Setup-1.1.0.exe
```

Real-world checks:
- `node scripts/real-links.js` downloads one known public video per site.
- `node scripts/real-finds.js` checks the three kinds of video Browse mode catches (a plain MP4, an HLS stream, a DASH stream).

## Note
For personal use. Only download videos you own or have permission to use, and respect each site's terms of service.
