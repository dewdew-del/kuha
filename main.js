// Kuha - Electron main process: window, tools, downloader, page view, and the IPC handlers
// behind window.kuha (see preload.js).
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require("electron");
const path = require("path");
const tools = require("./src/tools");
const settings = require("./src/settings");
const { createDownloader } = require("./src/downloader");
const { createBrowser } = require("./src/browser");
const { toUrl } = require("./src/address");
const { loadList, isBlocked, isAdPath } = require("./src/adblock");

let adList = new Set();
// Kept in memory: the page view asks on every request, and reading settings.json each time would lag.
let blockAds = true;
let win = null;
let toolPaths = { ytdlp: null, ffmpeg: null };
let downloader = null;
let browser = null;
let settingsFile;
let defaultSaveDir;

const getSettings = () => settings.load(settingsFile, defaultSaveDir);

function sendToWindow(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 560,
    title: "Kuha",
    icon: path.join(__dirname, "build", "icon.png"),
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // Kuha's own screen never navigates or opens windows. Websites only load in the page view (src/browser.js).
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

// Wrap each handler so the window always gets {ok, value} or {ok:false, error}.
function handle(name, fn) {
  ipcMain.handle(`kuha:${name}`, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

function requireTools() {
  if (!toolPaths.ytdlp || !toolPaths.ffmpeg) throw new Error("Kuha is damaged, please reinstall");
}

// Shared by pasted links and found videos.
function startJob({ format, quality, ...rest }) {
  requireTools();
  try {
    settings.ensureSaveDir(getSettings().saveDir);
  } catch {
    throw new Error("Can't save to this folder. Choose another one.");
  }
  return downloader.start({ ...rest, format: format === "mp3" ? "mp3" : "mp4", quality: String(quality) });
}

function registerHandlers() {
  handle("getInfo", (url) => {
    requireTools();
    return downloader.getInfo(String(url));
  });

  handle("download", ({ url, format, quality }) => startJob({ url: String(url), format, quality }));

  // The screen passes only the find's id; the address and headers are looked up here.
  handle("downloadFound", async ({ id, format, quality }) => {
    const f = await browser.getFind(String(id));
    if (!f) throw new Error("That video is no longer on this page. Play it again so Kuha can find it.");
    return startJob({ url: f.url, referer: f.referer, userAgent: f.userAgent, title: f.title, cookiesFile: f.cookiesFile, format, quality });
  });

  handle("cancel", (id) => downloader.cancel(String(id)));

  handle("openFile", async (p) => {
    if (!downloader.isKnownFile(p)) throw new Error("Not allowed");
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  });

  handle("showInFolder", (p) => {
    if (!downloader.isKnownFile(p)) throw new Error("Not allowed");
    shell.showItemInFolder(p);
  });

  handle("getSettings", () => getSettings());

  handle("setSettings", (partial = {}) => {
    const clean = {};
    if (partial.format === "mp4" || partial.format === "mp3") clean.format = partial.format;
    if (["best", "1080", "720", "480", "360"].includes(String(partial.quality))) clean.quality = String(partial.quality);
    if (typeof partial.blockAds === "boolean") clean.blockAds = blockAds = partial.blockAds;
    return settings.save(settingsFile, clean, defaultSaveDir);
  });

  handle("chooseFolder", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Choose where Kuha saves files",
      defaultPath: getSettings().saveDir,
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return getSettings();
    return settings.save(settingsFile, { saveDir: r.filePaths[0] }, defaultSaveDir);
  });

  handle("getVersions", async () => ({
    app: app.getVersion(),
    ytdlp: toolPaths.ytdlp && toolPaths.ffmpeg ? await tools.getVersion(toolPaths.ytdlp) : null,
  }));

  handle("updateYtdlp", () => {
    requireTools();
    return tools.updateYtdlp(toolPaths.ytdlp);
  });

  handle("browseGo", (text) => {
    const url = toUrl(String(text));
    if (!url) throw new Error("That address can't be opened. Use a site like example.com or a link that starts with http:// or https://.");
    browser.go(url);
  });
  handle("browseBack", () => browser.back());
  handle("browseForward", () => browser.forward());
  handle("browseReload", () => browser.reload());
  handle("browseStop", () => browser.stop());
  handle("browseSetBounds", (rect) => browser.setBounds(rect));
  handle("browseSetVisible", (visible) => browser.setVisible(visible));
  handle("browseClearData", () => browser.clearData());
}

app.whenReady().then(() => {
  // No default menu: its Ctrl+R would reload Kuha's own screen (wiping the download list) when
  // someone presses it to refresh a web page, and its zoom keys would misplace the page view.
  Menu.setApplicationMenu(null);
  const userData = app.getPath("userData");
  settingsFile = path.join(userData, "settings.json");
  defaultSaveDir = path.join(app.getPath("downloads"), "Kuha");

  const resourcesPath = app.isPackaged ? path.join(process.resourcesPath, "vendor") : path.join(__dirname, "vendor");
  toolPaths = tools.init({ resourcesPath, userDataPath: userData });
  adList = loadList(path.join(resourcesPath, "adhosts.txt"));
  blockAds = getSettings().blockAds !== false;

  downloader = createDownloader({
    ytdlp: toolPaths.ytdlp,
    ffmpeg: toolPaths.ffmpeg,
    getSaveDir: () => getSettings().saveDir,
  });
  downloader.on("progress", (e) => sendToWindow("kuha:progress", e));

  registerHandlers();
  createWindow();
  browser = createBrowser({
    win,
    getInfo: (url, signal, cookiesFile) => downloader.getInfo(url, signal, cookiesFile),
    // type "css" only asks whether blocking is on; "ping" tracking beacons are dropped; paths are checked for what a page loads, never for pages.
    shouldBlock: (hostname, url, type) =>
      blockAds && (type === "css" || type === "ping" || isBlocked(hostname, adList) || (type !== "mainFrame" && isAdPath(url))),
    onState: (s) => sendToWindow("kuha:browseState", s),
    onFound: (list) => sendToWindow("kuha:found", list),
  });

  // Keep sites working: update yt-dlp quietly in the background. Offline? Ignored.
  if (toolPaths.ytdlp) tools.updateYtdlp(toolPaths.ytdlp).catch(() => {});
});

app.on("window-all-closed", () => app.quit());
