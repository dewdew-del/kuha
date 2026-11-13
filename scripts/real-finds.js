// Real-world check for videos found on a page: one direct file, one HLS stream, one DASH stream,
// each started the way Browse mode starts a find (address + referer + user agent + page title).
// The streams are ten-minute videos, so they pass once 3% has arrived: that proves the stream
// list was read and pieces are coming in, without downloading the whole thing.
// Usage: node scripts/real-finds.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createDownloader } = require("../src/downloader");

const vendor = path.join(__dirname, "..", "vendor");
const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuha-finds-"));

// [name, address, referer, whole file?]
const FINDS = [
  ["Direct MP4", "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4", "https://test-videos.co.uk/", true],
  ["HLS", "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", "https://hls-js.netlify.app/", false],
  ["DASH", "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd", "https://reference.dashif.org/", false],
];
const TIMEOUT_MS = 5 * 60 * 1000;

const d = createDownloader({
  ytdlp: path.join(vendor, "yt-dlp.exe"),
  ffmpeg: vendor, // folder with ffmpeg.exe + ffprobe.exe
  getSaveDir: () => saveDir,
});

const jobs = new Map(); // id -> {name, whole, settled}
const started = Date.now();
let failed = 0;

function settle(job, ok, note) {
  if (job.settled) return;
  job.settled = true;
  if (!ok) failed++;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? "OK  " : "FAIL"} ${job.name}: ${note} (${secs}s)`);
  if ([...jobs.values()].every((j) => j.settled)) finish();
}

function finish() {
  console.log(`\n${FINDS.length - failed}/${FINDS.length} OK. Files in ${saveDir}`);
  // Give cancelled jobs a moment to stop yt-dlp and remove their partial files.
  setTimeout(() => process.exit(failed ? 1 : 0), 3000);
}

d.on("progress", (e) => {
  const job = jobs.get(e.id);
  if (!job || job.settled) return;
  if (e.status === "error") return settle(job, false, e.error);
  if (e.status === "done") {
    const kb = Math.round(fs.statSync(e.file).size / 1024);
    return settle(job, true, `${path.basename(e.file)} (${kb} KB)`);
  }
  if (!job.whole && e.status === "downloading" && e.progress >= 3) {
    settle(job, true, `stream is arriving (${e.progress.toFixed(1)}%), cancelled`);
    d.cancel(e.id);
  }
});

for (const [name, url, referer, whole] of FINDS) {
  const id = d.start({ url, format: "mp4", quality: "360", referer, userAgent: "Mozilla/5.0", title: `Kuha check ${name}` });
  jobs.set(id, { name, whole, settled: false });
}

setTimeout(() => {
  for (const [id, job] of jobs) {
    if (!job.settled) {
      d.cancel(id);
      settle(job, false, "timed out");
    }
  }
}, TIMEOUT_MS);
