// Kuha window logic. Talks to the back end only through window.kuha (preload.js).
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

// ---------- Start-up ----------
(async () => {
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

// ---------- Tabs ----------
$$(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    mode = b.dataset.tab;
    $$(".tabs button").forEach((x) => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-selected", String(x === b));
    });
    $$(".pane").forEach((p) => (p.hidden = p.id !== mode));
    placeView();
  })
);

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
async function openAddress() {
  const text = $("#addr").value.trim();
  if (!text) return;
  // A refused address gets its own line; the page that is already open stays as it is.
  const err = $("#addrError");
  err.hidden = true;
  try {
    await kuha.browse.go(text);
    $("#addr").blur(); // so the box can show the real address once the page loads
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}
$("#goAddr").addEventListener("click", openAddress);
$("#addr").addEventListener("keydown", (e) => {
  if (e.key === "Enter") openAddress();
});
$("#addr").addEventListener("focus", () => $("#addr").select());
$("#back").addEventListener("click", () => kuha.browse.back());
$("#fwd").addEventListener("click", () => kuha.browse.forward());
$("#reload").addEventListener("click", () => (page.loading ? kuha.browse.stop() : kuha.browse.reload()));

kuha.browse.onState((s) => {
  page = s;
  renderPage();
});

function renderPage() {
  const hasPage = !!page.url;
  $("#hint").hidden = hasPage || !!page.error;
  $("#pageError").hidden = !page.error;
  $("#pageError").textContent = page.error || "";
  $("#back").disabled = !page.canGoBack;
  $("#fwd").disabled = !page.canGoForward;
  const reload = $("#reload");
  reload.disabled = !hasPage;
  reload.textContent = page.loading ? "✕" : "⟳";
  reload.title = page.loading ? "Stop" : "Reload";
  reload.setAttribute("aria-label", reload.title);
  if (hasPage && document.activeElement !== $("#addr")) $("#addr").value = page.url;
  placeView();
}

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

$("#dlFound").addEventListener("click", () => {
  const f = finds.find((x) => x.id === $("#foundPick").value);
  if (!f) return;
  startJob(card(f.label, { title: f.label }), () => kuha.downloadFound({ id: f.id, format, quality }));
});

// ---------- Batch ----------
function updateButton() {
  const n = parseLinks($("#links").value).length;
  $("#go").textContent = n > 1 ? `Download ${n} links` : "Download";
  $("#go").disabled = n === 0;
}
$("#links").addEventListener("input", updateButton);

$("#go").addEventListener("click", async () => {
  // The main process queues them and runs at most 3 at once.
  for (const url of parseLinks($("#links").value)) {
    const li = card(url);
    if (await startJob(li, () => kuha.download({ url, format, quality }))) fillInfo(li, url);
  }
  $("#links").value = "";
  updateButton();
});

// ---------- Downloads list ----------
async function startJob(li, start) {
  try {
    const id = await start();
    li.dataset.id = id;
    cards.set(id, li);
    running.add(id);
    showCount();
    li.querySelector(".cancel").onclick = () => kuha.cancel(id);
    return true;
  } catch (e) {
    fail(li, e.message);
    if (/Choose another one/.test(e.message)) chooseFolder();
    return false;
  }
}

function showCount() {
  $("#dlCount").textContent = running.size || "";
}

function card(url, info) {
  $("#noDownloads").hidden = true;
  const li = document.createElement("li");
  li.className = "item";
  li.dataset.fmt = format.toUpperCase();
  li.innerHTML = `<img alt="" /><div><div class="title"></div><div class="meta"></div><div class="bar"><div></div></div></div><div class="act"><button type="button" class="ghost small cancel">Cancel</button></div>`;
  li.querySelector(".title").textContent = (info && info.title) || url;
  if (info && info.thumbnail) li.querySelector("img").src = info.thumbnail;
  li.dataset.base = [li.dataset.fmt, info && info.site, info && fmtTime(info.duration)].filter(Boolean).join(" · ");
  li.querySelector(".meta").textContent = `${li.dataset.base} · waiting...`;
  $("#list").prepend(li);
  return li;
}

// Batch: fetch the title and thumbnail alongside the download.
async function fillInfo(li, url) {
  try {
    const info = await kuha.getInfo(url);
    li.querySelector(".title").textContent = info.title || url;
    if (info.thumbnail) li.querySelector("img").src = info.thumbnail;
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
  li.querySelector(".bar div").style.width = `${j.progress}%`;
  if (j.status === "queued") meta.textContent = `${base} · waiting...`;
  if (j.status === "downloading") meta.textContent = `${base} · ${j.progress.toFixed(0)}%`;
  if (j.status === "converting") meta.textContent = `${base} · converting...`;
  if (j.status === "error") fail(li, j.error);
  if (j.status === "cancelled") {
    li.classList.add("cancelled");
    meta.textContent = `${base} · cancelled`;
    li.querySelector(".act").replaceChildren();
  }
  if (j.status === "done") {
    li.classList.add("done");
    meta.textContent = `${base} · saved`;
    const open = button("Open", "ghost small ok", () => kuha.openFile(j.file));
    const folder = button("Show in folder", "ghost small", () => kuha.showInFolder(j.file));
    li.querySelector(".act").replaceChildren(open, folder);
  }
});

function button(text, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.addEventListener("click", () => onClick().catch((e) => alert(e.message)));
  return b;
}

// ---------- Settings ----------
$("#openSettings").addEventListener("click", async () => {
  const s = await kuha.getSettings();
  $("#defFormat").value = s.format;
  $("#defQuality").value = s.quality;
  $("#blockAds").checked = s.blockAds !== false;
  $("#updateStatus").textContent = "";
  $("#settings").showModal();
  placeView(); // the page view would cover the dialog
  const v = await kuha.getVersions();
  $("#vApp").textContent = v.app;
  $("#vYtdlp").textContent = v.ytdlp || "missing";
});
$("#settings").addEventListener("close", placeView);
$("#defFormat").addEventListener("change", () => {
  setFormat($("#defFormat").value);
  kuha.setSettings({ format });
});
$("#defQuality").addEventListener("change", () => {
  setQuality($("#defQuality").value);
  kuha.setSettings({ quality });
});
$("#blockAds").addEventListener("change", () => kuha.setSettings({ blockAds: $("#blockAds").checked }));
$("#updateYtdlp").addEventListener("click", async () => {
  $("#updateStatus").textContent = "Checking...";
  try {
    const r = await kuha.updateYtdlp();
    $("#updateStatus").textContent = r.updated ? "Up to date" : "Couldn't update (offline?)";
    const v = await kuha.getVersions();
    $("#vYtdlp").textContent = v.ytdlp || "missing";
  } catch (e) {
    $("#updateStatus").textContent = e.message;
  }
});

function fmtTime(s) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}
