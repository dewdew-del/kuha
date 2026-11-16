// Pure helpers for talking to yt-dlp: build its arguments and read its output.
const crypto = require("crypto");
const path = require("path");

// A page title as a file name. "%" goes too: it is special in yt-dlp's -o template.
function safeTitle(title) {
  const clean = String(title ?? "")
    .replace(/[\/\\:*?"<>|%\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)
    .replace(/[. ]+$/, "");
  return clean || "video";
}

function buildArgs({ url, format, quality, saveDir, ffmpegPath, referer, userAgent, title, cookiesFile }) {
  // Found videos have no yt-dlp title or id, so they are named after the page plus a hash
  // of the address. The hash keeps two videos from the same page apart.
  const name = title
    ? `${safeTitle(title)} [${crypto.createHash("sha1").update(url).digest("hex").slice(0, 8)}].%(ext)s`
    : // The id keeps same-titled videos (e.g. "Video by user") from overwriting each other.
      "%(title).150B [%(id)s].%(ext)s";
  const args = [
    "--no-playlist",
    "--newline",
    "--no-warnings",
    "--windows-filenames",
    "--encoding", "utf-8", // otherwise Windows prints paths in the console code page and emoji break

    "--print", "after_move:filepath",
    // --print implies --quiet; turn progress and "Destination:" lines back on.
    "--no-quiet", "--progress",
    "--ffmpeg-location", ffmpegPath,
    // Streams come as hundreds of small pieces; fetching 8 at once is much faster than one by one.
    "--concurrent-fragments", "8",
    "-o", path.join(saveDir, name),
  ];
  // Many sites refuse a video request that doesn't come from their own page.
  if (referer) args.push("--referer", referer);
  if (userAgent) args.push("--user-agent", userAgent);
  // Lets yt-dlp's site extractors (e.g. Instagram's story extractor) see private/login-only content.
  if (cookiesFile) args.push("--cookies", cookiesFile);
  if (format === "mp3") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    const h = /^\d+$/.test(String(quality)) ? `[height<=${quality}]` : "";
    // Prefer H.264/AAC so the MP4 plays everywhere; fall back to anything.
    args.push(
      "-f", `bv*${h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*${h}+ba/b${h}/b`,
      "--merge-output-format", "mp4",
      "--remux-video", "mp4"
    );
  }
  args.push(url);
  return args;
}

function parseProgress(line) {
  const m = /\[download\]\s+([\d.]+)%/.exec(line);
  return m ? parseFloat(m[1]) : null;
}

function isConverting(line) {
  return /\[(Merger|ExtractAudio|VideoRemuxer)\]/.test(line);
}

// yt-dlp prints the final path (from --print after_move:filepath) as its own line.
function parseFilepath(stdout) {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[A-Za-z]:[\\/]/.test(lines[i]) || lines[i].startsWith("/")) return lines[i];
  }
  return null;
}

module.exports = { buildArgs, safeTitle, parseProgress, isConverting, parseFilepath };
