// The only bridge between the window and the back end. The window gets window.kuha
// with this fixed list of methods and nothing else (no Node, no file access).
const { contextBridge, ipcRenderer } = require("electron");

// Main returns {ok, value} or {ok:false, error}, so the window sees the plain message
// instead of Electron's "Error invoking remote method ..." wrapper.
async function call(method, ...args) {
  const r = await ipcRenderer.invoke(`kuha:${method}`, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

// Subscribe to an event from main; returns the unsubscribe function.
const on = (channel) => (cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(`kuha:${channel}`, listener);
  return () => ipcRenderer.removeListener(`kuha:${channel}`, listener);
};

contextBridge.exposeInMainWorld("kuha", {
  getInfo: (url) => call("getInfo", url),
  download: (opts) => call("download", opts),
  downloadFound: (opts) => call("downloadFound", opts),
  cancel: (id) => call("cancel", id),
  onProgress: on("progress"),
  openFile: (p) => call("openFile", p),
  showInFolder: (p) => call("showInFolder", p),
  getSettings: () => call("getSettings"),
  setSettings: (partial) => call("setSettings", partial),
  chooseFolder: () => call("chooseFolder"),
  getVersions: () => call("getVersions"),
  updateYtdlp: () => call("updateYtdlp"),
  browse: {
    go: (text) => call("browseGo", text),
    back: () => call("browseBack"),
    forward: () => call("browseForward"),
    reload: () => call("browseReload"),
    stop: () => call("browseStop"),
    setBounds: (rect) => call("browseSetBounds", rect),
    setVisible: (visible) => call("browseSetVisible", visible),
    onState: on("browseState"),
    onFound: on("found"),
  },
});
