// The page view: a locked-down browser inside the Kuha window that reports the videos a page loads.
// Web pages here get no preload, so they can never reach window.kuha or anything of Kuha's.
const { WebContentsView, session } = require("electron");
const { classify, fromHeaders, createFinds, pageName } = require("./sniff");
const { samePage, sameSite } = require("./address");

const isWeb = (url) => /^https?:\/\//i.test(String(url));
const LOOKUP_DELAY_MS = 800;
const LOAD_ERROR = "Couldn't open this page. Check the address and your internet.";

// Page parts that are almost always ads, hidden on every page while the ad blocker is on.
const HIDE_ADS = `ins.adsbygoogle, .adsbygoogle, [id^="google_ads"], [id^="div-gpt-ad"], [id*="taboola"], [class*="taboola"], [aria-label="Advertisement"], iframe[src*="doubleclick.net"], iframe[src*="googlesyndication"], iframe[src*="popunder"] { display: none !important; }`;

function createBrowser({ win, getInfo, shouldBlock, onState, onFound }) {
  const ses = session.fromPartition("persist:browse");
  // Sites treat an "Electron" browser oddly; the same string is sent with downloads.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(?:kuha|Electron)\/\S+/gi, ""));
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // Only Kuha's own Download button saves files.
  ses.on("will-download", (e) => e.preventDefault());

  const view = new WebContentsView({
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const wc = view.webContents;
  view.setBackgroundColor("#ffffff");
  view.setVisible(false);
  win.contentView.addChildView(view);

  const finds = createFinds();
  let error = null;
  let mainFind = null; // a video opened as the page itself; its response arrives before the page change
  let lookupTimer = null;
  let lookupAbort = null; // cancels the yt-dlp lookup of a page the user has left
  let pageUrl = ""; // the address the current finds belong to
  let lastFound = "[]";

  const sendState = () =>
    onState({
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error,
    });

  // The screen only hears about the list when it really changed.
  function sendFound() {
    const list = finds.list(pageName(wc.getTitle(), wc.getURL()));
    const key = JSON.stringify(list);
    if (key === lastFound) return;
    lastFound = key;
    onFound(list);
  }

  // type: "mainFrame" for a page address, else the kind of thing being loaded (script, image, ping...).
  const isAd = (url, type = "mainFrame") => {
    try {
      return shouldBlock(new URL(url).hostname, url, type);
    } catch {
      return false;
    }
  };

  // Ad blocking: cancel what a page pulls in from known ad/tracker sites before it loads.
  // The page itself (mainFrame) is not cancelled here, because that would leave a blank error
  // page; a page trying to send the user to an ad site is stopped in will-navigate below.
  // Runs for every request, so it is one name lookup and nothing else.
  ses.webRequest.onBeforeRequest((d, done) => {
    done({ cancel: d.resourceType !== "mainFrame" && (d.resourceType === "ping" || isWeb(d.url)) && isAd(d.url, d.resourceType) });
  });

  // Header checks only: this runs for every response the page gets, so it must stay cheap.
  ses.webRequest.onResponseStarted((d) => {
    if (d.webContentsId !== wc.id) return;
    const { contentType, contentLength } = fromHeaders(d.responseHeaders);
    const kind = classify({ url: d.url, statusCode: d.statusCode, contentType, contentLength });
    if (d.resourceType === "mainFrame") {
      mainFind = kind ? { kind, url: d.url, sizeBytes: contentLength } : null;
      return;
    }
    if (kind && finds.add({ kind, url: d.url, sizeBytes: contentLength })) sendFound();
  });

  function onPageChange(inPage) {
    // A #fragment change (anchor, player time mark) is still the same page: keep its finds
    // and don't start another yt-dlp lookup.
    if (inPage && samePage(wc.getURL(), pageUrl)) return sendState();
    pageUrl = wc.getURL();
    finds.clear();
    if (mainFind) finds.add(mainFind);
    mainFind = null;
    sendFound();
    sendState();

    // Ask yt-dlp about the page once it settles; fast clicking only triggers one lookup.
    clearTimeout(lookupTimer);
    if (lookupAbort) lookupAbort.abort(); // a lookup for the old page is wasted work
    lookupAbort = null;
    const lookupUrl = pageUrl;
    if (!isWeb(lookupUrl) || new URL(lookupUrl).hostname === "www.google.com") return;
    lookupTimer = setTimeout(() => {
      lookupAbort = new AbortController();
      getInfo(lookupUrl, lookupAbort.signal).then(
        (info) => {
          if (wc.isDestroyed() || wc.getURL() !== lookupUrl) return; // the user has moved on
          finds.add({ kind: "site", url: lookupUrl, title: info.title });
          sendFound();
        },
        () => {} // yt-dlp doesn't know this page; the response watcher still works
      );
    }, LOOKUP_DELAY_MS);
  }

  wc.on("did-navigate", () => onPageChange(false));
  wc.on("dom-ready", () => {
    if (shouldBlock("", "", "css")) wc.insertCSS(HIDE_ADS).catch(() => {});
  });
  wc.on("did-navigate-in-page", (_e, _url, isMainFrame) => {
    if (isMainFrame) onPageChange(true);
  });
  wc.on("did-start-loading", () => {
    error = null;
    sendState();
  });
  wc.on("did-stop-loading", sendState);
  wc.on("page-title-updated", () => {
    sendState();
    sendFound(); // labels carry the page title
  });
  wc.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: cancelled, e.g. the user clicked another link
    error = LOAD_ERROR;
    sendState();
  });

  // No pop-up windows. A link to the same site that wants a new window opens here instead;
  // a pop-up to any other site is dropped, because that is how click-hijack ads take over a page.
  wc.setWindowOpenHandler(({ url }) => {
    if (isWeb(url) && sameSite(url, wc.getURL())) wc.loadURL(url).catch(() => {});
    return { action: "deny" };
  });
  // Navigation the page starts (a link, a script, a redirect): web addresses only, and never to
  // an ad site. Stopping it here keeps the user on the page they were on. An address the user
  // types goes through go() and does not pass here, so they can still open any site themselves.
  const webOnly = (e, url) => {
    if (!isWeb(url) || isAd(url)) e.preventDefault();
  };
  wc.on("will-navigate", webOnly);
  // Electron shows no "Leave site?" box, so a page with a beforeunload handler would silently
  // refuse every Back / Go. The user chose to leave, so let them.
  wc.on("will-prevent-unload", (e) => e.preventDefault());
  wc.on("will-redirect", webOnly);

  return {
    go(url) {
      if (!isWeb(url)) throw new Error("That address can't be opened.");
      wc.loadURL(url).catch(() => {}); // a failed load is reported through did-fail-load
    },
    back: () => wc.navigationHistory.goBack(),
    forward: () => wc.navigationHistory.goForward(),
    reload: () => wc.reload(),
    stop: () => wc.stop(),
    setBounds(rect) {
      const { x, y, width, height } = rect || {};
      const n = [x, y, width, height].map(Number);
      if (!n.every(Number.isFinite)) return;
      view.setBounds({ x: Math.round(n[0]), y: Math.round(n[1]), width: Math.max(0, Math.round(n[2])), height: Math.max(0, Math.round(n[3])) });
    },
    setVisible: (visible) => view.setVisible(!!visible),
    // Forget everything the sites stored: logins, cookies, cache, site data.
    async clearData() {
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
    },
    // Everything the downloader needs for a find. The screen only ever holds the id.
    getFind(id) {
      const f = finds.get(id);
      if (!f) return undefined;
      if (f.kind === "site") return { kind: f.kind, url: f.url };
      return { kind: f.kind, url: f.url, referer: wc.getURL(), userAgent: ses.getUserAgent(), title: pageName(wc.getTitle(), wc.getURL()) };
    },
  };
}

module.exports = { createBrowser };
