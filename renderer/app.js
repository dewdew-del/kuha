// Kuha window logic. Talks to the back end only through window.kuha (preload.js).
// Pure helpers (parseLinks, matchShortcut, fmtTime, hostOf) come from links.js and ui.js.
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
let format = "mp4";
let quality = "best";
let mode = "browse";
let page = { url: "", loading: false, canGoBack: false, canGoForward: false, error: null }; // last report from the page view
let finds = []; // videos found on the current page: {id, kind, label, sizeBytes}
let userPicked = false; // the user chose a find by hand, so don't jump back to the first
const cards = new Map(); // job id -> card element
const running = new Set(); // ids of jobs that haven't finished
const calm = matchMedia("(prefers-reduced-motion: reduce)"); // script-driven motion honours this too

// ---------- Theme (kept in this window's own storage; "system" follows Windows) ----------
const light = matchMedia("(prefers-color-scheme: light)");
function themePref() {
  try {
    return localStorage.getItem("theme") || "system";
  } catch {
    return "system";
  }
}
function applyTheme() {
  const p = themePref();
  document.documentElement.dataset.theme = p === "system" ? (light.matches ? "light" : "dark") : p;
}
light.addEventListener("change", applyTheme);
applyTheme();

// ---------- Start-up ----------
(async () => {
  $("#addr").focus(); // ready to paste
  const s = await kuha.getSettings();
  setFormat(s.format);
  setQuality(s.quality);
  $("#saveDir").textContent = s.saveDir;
  const v = await kuha.getVersions();
  if (!v.ytdlp) showWarn("Kuha is damaged, please reinstall");
})().catch((e) => showWarn(e.message));

function showWarn(text) {
  $("#warn").hidden = false;
  $("#warn").textContent = text;
}

// ---------- Short messages (outside the page area, so the page view can't cover them) ----------
let toastTimer;
function toast(text, { error = false, view = false } = {}) {
  $("#toastText").textContent = text;
  $("#toast").classList.toggle("bad", error);
  $("#toastView").hidden = !view;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), error ? 7000 : 4000);
}
$("#toastView").addEventListener("click", () => {
  selectTab("downloads");
  $("#toast").hidden = true;
});

// ---------- Tabs ----------
const tabs = [...$$(".tabs button")];
function selectTab(name) {
  mode = name;
  tabs.forEach((x) => {
    const on = x.dataset.tab === name;
    x.classList.toggle("on", on);
    x.setAttribute("aria-selected", String(on));
    x.tabIndex = on ? 0 : -1; // one tab stop; arrow keys move between tabs
  });
  $$(".pane").forEach((p) => (p.hidden = p.id !== name));
  placeView();
}
tabs.forEach((b, i) => {
  b.addEventListener("click", () => selectTab(b.dataset.tab));
  b.addEventListener("keydown", (e) => {
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    selectTab(next.dataset.tab);
    next.focus();
  });
});

// ---------- Format / quality (one value each, shown in Browse and Batch, remembered as the defaults) ----------
function setFormat(f) {
  format = f === "mp3" ? "mp3" : "mp4";
  $$(".seg button").forEach((x) => {
    x.classList.toggle("on", x.dataset.fmt === format);
    x.setAttribute("aria-pressed", String(x.dataset.fmt === format));
  });
  $$("select.quality").forEach((s) => (s.disabled = format === "mp3"));
}
function setQuality(q) {
  quality = q;
  $$("select.quality").forEach((s) => (s.value = q));
}
$$(".seg button").forEach((b) =>
  b.addEventListener("click", () => {
    setFormat(b.dataset.fmt);
    kuha.setSettings({ format });
  })
);
$$("select.quality").forEach((s) =>
  s.addEventListener("change", () => {
    setQuality(s.value);
    kuha.setSettings({ quality });
  })
);

// ---------- Save folder ----------
$("#changeFolder").addEventListener("click", chooseFolder);
async function chooseFolder() {
  const s = await kuha.chooseFolder();
  $("#saveDir").textContent = s.saveDir;
}

// ---------- Browse: address bar ----------
function addrError(text) {
  $("#addrError").textContent = text || "";
  $("#addrError").hidden = !text;
}
function syncGo() {
  $("#goAddr").disabled = !$("#addr").value.trim();
}
async function openAddress() {
  const text = $("#addr").value.trim();
  if (!text) return;
  // A refused address gets its own line; the page that is already open stays as it is.
  addrError("");
  try {
    await kuha.browse.go(text);
    $("#addr").blur(); // so the box can show the real address once the page loads
  } catch (e) {
    addrError(e.message);
  }
}
$("#goAddr").addEventListener("click", openAddress);
$("#addr").addEventListener("keydown", (e) => {
  if (e.key === "Enter") openAddress();
});
$("#addr").addEventListener("input", () => {
  syncGo();
  addrError("");
});
$("#addr").addEventListener("focus", () => $("#addr").select());
$("#back").addEventListener("click", () => kuha.browse.back());
$("#fwd").addEventListener("click", () => kuha.browse.forward());
$("#reload").addEventListener("click", () => (page.loading ? kuha.browse.stop() : kuha.browse.reload()));
$("#retry").addEventListener("click", () => kuha.browse.reload());

// Pasting into the box searches straight away (the box has updated by the next tick).
$("#addr").addEventListener("paste", () => setTimeout(() => { syncGo(); openAddress(); }, 0));

kuha.browse.onState((s) => {
  page = s;
  renderPage();
});

function renderPage() {
  const hasPage = !!page.url;
  $("#hint").hidden = hasPage || !!page.error;
  $("#pageErrorBox").hidden = !page.error;
  $("#pageError").textContent = page.error || "";
  $("#back").disabled = !page.canGoBack;
  $("#fwd").disabled = !page.canGoForward;
  const reload = $("#reload");
  reload.disabled = !hasPage;
  reload.textContent = page.loading ? "✕" : "⟳";
  reload.title = page.loading ? "Stop (Esc)" : "Reload (F5)";
  reload.setAttribute("aria-label", page.loading ? "Stop loading" : "Reload");
  $(".addrrow").classList.toggle("loading", page.loading && !page.error);
  $("#pageArea").setAttribute("aria-busy", String(page.loading));
  // chrome-error:// is Chromium's own failed-page address; the box keeps what the user typed.
  if (/^https?:/i.test(page.url) && document.activeElement !== $("#addr")) {
    $("#addr").value = page.url;
    syncGo();
  }
  placeView();
}

// ---------- Browse: keyboard shortcuts (the default menu is gone, so Kuha handles them) ----------
// They work while Kuha's own screen has focus. A click inside the web page gives that page the
// keyboard, and its key presses never reach this screen.
document.addEventListener("keydown", (e) => {
  if ($("#settings").open) return;
  const act = matchShortcut(e);
  if (!act) return;
  if (act === "address") {
    e.preventDefault();
    selectTab("browse");
    $("#addr").focus();
  } else if (act === "reload") {
    e.preventDefault(); // never lets Ctrl+R / F5 reload Kuha's own screen
    if (mode === "browse" && page.url) kuha.browse.reload();
  } else if (mode !== "browse") {
    return;
  } else if (act === "back" && page.canGoBack) {
    e.preventDefault();
    kuha.browse.back();
  } else if (act === "forward" && page.canGoForward) {
    e.preventDefault();
    kuha.browse.forward();
  } else if (act === "escape") {
    if (page.loading) kuha.browse.stop();
    else if (document.activeElement === $("#addr")) {
      $("#addr").value = /^https?:/i.test(page.url) ? page.url : ""; // give the box its old address back
      syncGo();
      addrError("");
      $("#addr").blur();
    }
  }
});

// ---------- Browse: keep the page view exactly over #pageArea ----------
// The page view is a native layer on top of this screen, so it must be hidden whenever
// something of ours (another tab, an error, the Settings dialog) needs that space.
let placeQueued = false;
let lastPlace = "";
function placeView() {
  if (placeQueued) return; // at most one update per frame, however many resize events arrive
  placeQueued = true;
  requestAnimationFrame(() => {
    placeQueued = false;
    const visible = mode === "browse" && !!page.url && !page.error && !$("#settings").open;
    const r = $("#pageArea").getBoundingClientRect();
    // 1px inset keeps the box's border visible around the page.
    const rect = { x: r.x + 1, y: r.y + 1, width: r.width - 2, height: r.height - 2 };
    const key = visible ? JSON.stringify(rect) : "hidden";
    if (key === lastPlace) return;
    lastPlace = key;
    if (visible) kuha.browse.setBounds(rect);
    kuha.browse.setVisible(visible);
  });
}
new ResizeObserver(placeView).observe($("#pageArea"));

// ---------- Browse: found videos ----------
kuha.browse.onFound((list) => {
  finds = list;
  const pick = $("#foundPick");
  const previous = pick.value;
  pick.replaceChildren(...list.map((f) => new Option(f.label, f.id)));
  if (!list.length) userPicked = false;
  // Keep the user's own choice; otherwise show the first one (yt-dlp's result when there is one).
  if (userPicked && list.some((f) => f.id === previous)) pick.value = previous;
  $("#foundLabel").textContent = list.length > 1 ? `${list.length} videos found:` : "Video found:";
  $("#found").hidden = list.length === 0;
  placeView(); // the bar appearing or going changes the page area's size
});
$("#foundPick").addEventListener("change", () => (userPicked = true));

let addedTimer;
$("#dlFound").addEventListener("click", async () => {
  const f = finds.find((x) => x.id === $("#foundPick").value);
  if (!f) return;
  const err = await startJob(card(f.label, { title: f.label, site: hostOf(page.url) }), () =>
    kuha.downloadFound({ id: f.id, format, quality })
  );
  if (err) return toast(err, { error: true });
  // The tab doesn't switch (the page stays in view), so say clearly that it worked.
  const btn = $("#dlFound");
  btn.textContent = "Added ✓";
  btn.disabled = true; // a double click would start it twice
  clearTimeout(addedTimer);
  addedTimer = setTimeout(() => {
    btn.textContent = "Download";
    btn.disabled = false;
  }, 1200);
  toast("Added to Downloads", { view: true });
});

// ---------- Batch ----------
function updateButton() {
  const text = $("#links").value;
  const n = parseLinks(text).length;
  $("#go").textContent = n > 1 ? `Download ${n} links` : "Download";
  $("#go").disabled = n === 0;
  const hint = $("#batchHint");
  hint.classList.toggle("err", !n && !!text.trim());
  hint.textContent = n
    ? `${n} ${n === 1 ? "link" : "links"} ready.`
    : text.trim()
      ? "No links found. Each link must start with http:// or https://."
      : "Paste links that start with http:// or https://.";
}
$("#links").addEventListener("input", updateButton);

$("#go").addEventListener("click", async () => {
  // The main process queues them and runs at most 3 at once.
  let started = 0;
  let failed = 0;
  for (const url of parseLinks($("#links").value)) {
    const li = card(url);
    if (await startJob(li, () => kuha.download({ url, format, quality }))) failed++;
    else {
      started++;
      fillInfo(li, url);
    }
  }
  $("#links").value = "";
  updateButton();
  const added = `${started} ${started === 1 ? "download" : "downloads"} added`;
  if (failed) toast(`${added}, ${failed} couldn't start. See Downloads.`, { error: true, view: true });
  else toast(added, { view: true });
});

// ---------- Downloads list ----------
// Resolves to null when the job started, or to the error message when it didn't.
async function startJob(li, start) {
  try {
    const id = await start();
    li.dataset.id = id;
    cards.set(id, li);
    running.add(id);
    showCount();
    li.querySelector(".cancel").onclick = () => kuha.cancel(id);
    return null;
  } catch (e) {
    fail(li, e.message);
    if (/Choose another one/.test(e.message)) chooseFolder();
    return e.message;
  }
}

// The badge on the Downloads tab: how many are running. It pops when one is added.
function showCount() {
  const el = $("#dlCount");
  const grew = running.size > Number(el.textContent || 0);
  el.textContent = running.size || "";
  $("#tab-downloads").setAttribute("aria-label", running.size ? `Downloads, ${running.size} running` : "Downloads");
  if (grew && !calm.matches) el.animate([{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 300 });
}

function setTitle(li, text) {
  const t = li.querySelector(".title");
  t.textContent = text;
  t.title = text; // the card clips long titles
  li.dataset.name = text;
  const cancel = li.querySelector(".cancel");
  if (cancel) cancel.setAttribute("aria-label", `Cancel ${text}`);
}

function card(url, info) {
  $("#noDownloads").hidden = true;
  const li = document.createElement("li");
  li.className = "item";
  li.dataset.fmt = format.toUpperCase();
  // .thumb shows a placeholder (a play or music glyph from the CSS) until a real picture loads.
  li.innerHTML = `<div class="thumb"><img alt="" /></div><div><div class="title"></div><div class="meta"></div><div class="bar" aria-hidden="true"><div></div></div></div><div class="act"><button type="button" class="ghost small cancel">Cancel</button></div>`;
  setTitle(li, (info && info.title) || url);
  setThumb(li, info && info.thumbnail);
  li.dataset.base = [li.dataset.fmt, info && info.site, info && fmtTime(info.duration)].filter(Boolean).join(" · ");
  li.querySelector(".meta").textContent = `${li.dataset.base} · waiting...`;
  $("#list").prepend(li);
  return li;
}

function setThumb(li, src) {
  if (!src) return;
  const img = li.querySelector("img");
  img.addEventListener("error", () => img.remove(), { once: true }); // keep the placeholder
  img.src = src;
}

// Batch: fetch the title and thumbnail alongside the download.
async function fillInfo(li, url) {
  try {
    const info = await kuha.getInfo(url);
    setTitle(li, info.title || url);
    setThumb(li, info.thumbnail);
    li.dataset.base = [li.dataset.fmt, info.site, fmtTime(info.duration)].filter(Boolean).join(" · ");
  } catch {
    // The download itself reports any real error.
  }
}

function fail(li, msg) {
  li.classList.add("error");
  li.querySelector(".meta").textContent = msg;
  li.querySelector(".act").replaceChildren();
}

kuha.onProgress((j) => {
  if (["done", "error", "cancelled"].includes(j.status) && running.delete(j.id)) showCount();
  const li = cards.get(j.id);
  if (!li) return;
  const meta = li.querySelector(".meta");
  const base = li.dataset.base;
  li.querySelector(".bar div").style.transform = `scaleX(${j.progress / 100})`; // transform, not width: no layout work
  if (j.status === "queued") meta.textContent = `${base} · waiting...`;
  if (j.status === "downloading") meta.textContent = `${base} · ${j.progress.toFixed(0)}%`;
  if (j.status === "converting") meta.textContent = `${base} · converting...`;
  if (j.status === "error") {
    fail(li, j.error);
    if (mode !== "downloads") toast(`A download failed: ${j.error}`, { error: true, view: true });
  }
  if (j.status === "cancelled") {
    li.classList.add("cancelled");
    meta.textContent = `${base} · cancelled`;
    li.querySelector(".act").replaceChildren();
  }
  if (j.status === "done") {
    const name = li.dataset.name;
    li.classList.add("done");
    meta.textContent = `${base} · saved`;
    const open = button("Open", `Open ${name}`, "ghost small ok", () => kuha.openFile(j.file));
    const folder = button("Show in folder", `Show ${name} in its folder`, "ghost small", () => kuha.showInFolder(j.file));
    li.querySelector(".act").replaceChildren(open, folder);
    if (mode !== "downloads") toast(`Saved: ${name}`, { view: true });
  }
});

function button(text, label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", () => onClick().catch((e) => toast(`${e.message} Check that the file is still there.`, { error: true })));
  return b;
}

// ---------- Settings ----------
$("#openSettings").addEventListener("click", async () => {
  const s = await kuha.getSettings();
  $("#theme").value = themePref();
  $("#defFormat").value = s.format;
  $("#defQuality").value = s.quality;
  $("#blockAds").checked = s.blockAds !== false;
  $("#settings").showModal();
  placeView(); // the page view would cover the dialog
});
$("#settings").addEventListener("close", placeView);
$("#theme").addEventListener("change", () => {
  try {
    localStorage.setItem("theme", $("#theme").value);
  } catch {}
  applyTheme();
});
$("#defFormat").addEventListener("change", () => {
  setFormat($("#defFormat").value);
  kuha.setSettings({ format });
});
$("#defQuality").addEventListener("change", () => {
  setQuality($("#defQuality").value);
  kuha.setSettings({ quality });
});
$("#clearData").addEventListener("click", async () => {
  const hint = $("#clearHint");
  try {
    await kuha.browse.clearData();
    hint.textContent = "Cleared. Reload the page to see it signed out.";
  } catch (err) {
    hint.textContent = "Couldn't clear: " + err.message;
  }
});
$("#blockAds").addEventListener("change",() => kuha.setSettings({ blockAds: $("#blockAds").checked }));
