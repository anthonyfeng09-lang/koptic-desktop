/**
 * Koptic Desktop, for Windows, Mac and Linux.
 *
 * Installed from the one-file installers GitHub builds (see
 * .github/workflows/release.yml), or run from this folder with install.cmd /
 * install.sh. Updates itself when installed (electron-updater).
 *
 * - The Koptic window: koptic.vercel.app in its own window and tray icon.
 * - Its own Classroom window: you sign in once with your school account, and
 *   from then on the app reads your To-do list (every Google account signed
 *   in there, skipping ones with no classes), opens each assignment to get
 *   the instructions, and reads attached Google Docs. All of it goes to
 *   Koptic with your connection token, the same one the extension uses.
 * - Syncs when it starts, every 2 hours, and from the tray's "Sync now".
 *
 * Read only: it never turns in, edits or posts anything in Classroom.
 */
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, safeStorage, session, shell } = require("electron");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { READ_TODO, READ_DETAIL, READ_CLASSES, READ_WORK } = require("./classroom-scripts");

const KOPTIC = "https://koptic.vercel.app";
const SYNC_EVERY_MS = 2 * 60 * 60 * 1000;
const MAX_ACCOUNTS = 5;
const MAX_DETAILS = 25;

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let classroomWindow = null;
let tray = null;
let syncing = false;
let lastSync = null;

// ---------------- settings and the token ----------------

const dataFile = (name) => path.join(app.getPath("userData"), name);

/** What the last sync saw, next to the app, so a sync that brings in nothing
 *  can be explained. Overwritten each sync; only titles and counts. */
const SYNC_LOG = path.join(app.getPath("userData"), "last-sync.txt");
let syncLog = [];
const logLine = (line) => syncLog.push(`${new Date().toISOString()} ${line}`);
const flushLog = () => {
  try {
    fs.writeFileSync(SYNC_LOG, syncLog.join("\n") + "\n");
  } catch {}
};

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(dataFile("settings.json"), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(dataFile("settings.json"), JSON.stringify(next, null, 2));
  return next;
}

function readToken() {
  try {
    const buf = fs.readFileSync(dataFile("token.bin"));
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
  } catch {
    return null;
  }
}

function saveToken(token) {
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, "utf8");
  fs.writeFileSync(dataFile("token.bin"), buf);
}

// ---------------- windows ----------------

function showKoptic(route = "/today") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    if (route) mainWindow.loadURL(KOPTIC + route);
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    title: "Koptic",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      partition: "persist:koptic",
      preload: path.join(__dirname, "preload-koptic.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWindow.loadURL(KOPTIC + route);
  // Links to other sites open in the normal browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(KOPTIC)) shell.openExternal(url);
    return { action: url.startsWith(KOPTIC) ? "allow" : "deny" };
  });
  // Closing hides to the tray, so syncing keeps going.
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function getClassroomWindow(show) {
  if (!classroomWindow || classroomWindow.isDestroyed()) {
    classroomWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      show: false,
      title: "Classroom (Koptic)",
      icon: path.join(__dirname, "icon.png"),
      autoHideMenuBar: true,
      // Not throttled while hidden: Chromium slows a hidden page's timers to
      // about once a minute, which turned a 30 second read into a stuck sync.
      webPreferences: { partition: "persist:classroom", contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    classroomWindow.on("close", (e) => {
      if (!app.isQuitting) {
        e.preventDefault();
        classroomWindow.hide();
      }
    });
  }
  if (show) {
    classroomWindow.show();
    classroomWindow.focus();
  }
  return classroomWindow;
}

function signInToClassroom() {
  const win = getClassroomWindow(true);
  win.loadURL("https://classroom.google.com/");
  notify("Sign in to Classroom", "Use your school account. Close this window when you see your classes.");
}

// ---------------- sync ----------------

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, "icon.png") }).show();
}

/** Run a reader in the Classroom window, giving up after `ms` instead of
 *  waiting forever on a page that never settles. */
function run(win, code, ms = 45000) {
  return Promise.race([
    win.webContents.executeJavaScript(code, true),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Classroom took too long")), ms)),
  ]);
}

async function load(win, url) {
  await win.loadURL(url).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
}

async function postJson(route, body) {
  const res = await fetch(KOPTIC + route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Koptic said ${res.status}`);
  return data;
}

/** Text of a Google Doc the school account can open, or "" if it can't. */
async function docText(id, account, max = 12000) {
  try {
    const ses = session.fromPartition("persist:classroom");
    const res = await ses.fetch(
      `https://docs.google.com/document/d/${id}/export?format=txt&authuser=${account}`,
    );
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("text/plain")) return "";
    return (await res.text()).slice(0, max);
  } catch {
    return "";
  }
}

let syncStartedAt = 0;

async function syncClassroom({ deep = false, quiet = false } = {}) {
  // A sync that somehow never finished must not block every later one.
  if (syncing && Date.now() - syncStartedAt < 10 * 60 * 1000) return;
  const token = readToken();
  if (!token) {
    if (!quiet) {
      notify("Connect Koptic first", "Opening Connect Classroom. Sign in to Koptic there.");
      showKoptic("/connect/classroom");
    }
    return;
  }
  syncing = true;
  syncStartedAt = Date.now();
  syncLog = [];
  logLine(`sync start deep=${deep} quiet=${quiet}`);
  flushLog();
  updateTray();
  const win = getClassroomWindow(false);
  const settings = readSettings();
  const order = [settings.classroomAccount ?? 0, ...Array.from({ length: MAX_ACCOUNTS }, (_, i) => i)].filter(
    (n, i, all) => all.indexOf(n) === i,
  );

  let added = 0;
  let filled = 0;
  let turnedIn = 0;
  let found = false;
  try {
    for (const account of order) {
      await load(win, `https://classroom.google.com/u/${account}/a/not-turned-in/all`);
      const todo = await run(win, READ_TODO).catch((e) => {
        logLine(`account ${account}: read failed ${e && e.message}`);
        return null;
      });
      logLine(
        `account ${account}: url=${win.webContents.getURL()} signedIn=${todo && todo.signedIn} hasClasses=${todo && todo.hasClasses} sections=${todo && todo.texts ? todo.texts.length : 0} links=${todo && todo.links ? todo.links.length : 0}`,
      );
      if (!todo || !todo.signedIn) {
        if (account === order[0] && !found) {
          if (!quiet) signInToClassroom();
          break;
        }
        continue;
      }
      if (!todo.hasClasses) continue;
      found = true;
      writeSettings({ classroomAccount: account });

      // Every class, then each class's "Your work" page: every assignment,
      // its due date and whether it's handed in.
      let classes = [];
      try {
        await load(win, `https://classroom.google.com/u/${account}/h`);
        const list = await run(win, READ_CLASSES).catch(() => null);
        if (list && list.classes && list.classes.length > 0) {
          classes = list.classes;
          const r = await postJson("/api/desktop/classes", { token, classes });
          logLine(`classes: read ${classes.length}, added ${r.added}: ${classes.map((c) => c.name).join(" | ")}`);
        } else {
          logLine("classes: none read");
        }
      } catch (err) {
        logLine(`classes failed: ${err && err.message ? err.message : err}`);
      }

      const needDetails = [];
      let workRead = 0;
      for (const c of classes.filter((x) => x.workHref)) {
        await load(win, `https://classroom.google.com${c.workHref}`);
        const work = await run(win, READ_WORK, 60000).catch(() => null);
        if (!work || !work.signedIn) continue;
        workRead += 1;
        if (!Array.isArray(work.items) || work.items.length === 0) continue;
        try {
          const r = await postJson("/api/desktop/work", { token, courseName: c.name, items: work.items });
          added += Number(r.added) || 0;
          turnedIn += Number(r.statusChanged) || 0;
          for (const d of r.needDetails || []) needDetails.push({ ...d, classId: c.id, courseName: c.name });
          logLine(`work ${c.name}: ${work.items.length} items -> ${JSON.stringify(r).slice(0, 200)}`);
        } catch (err) {
          logLine(`work ${c.name} failed: ${err && err.message ? err.message : err}`);
        }
      }

      // The To-do pages are the fallback when no "Your work" page could be read.
      if (workRead === 0) {
        for (const text of todo.texts.filter((t) => t.length >= 20)) {
          const r = await postJson("/api/extension/import", { token, text });
          added += Number(r.added) || 0;
          logLine(`posted ${text.length} chars -> ${JSON.stringify(r).slice(0, 300)}`);
        }
        await load(win, `https://classroom.google.com/u/${account}/a/missing/all`);
        const missing = await run(win, READ_TODO).catch(() => null);
        if (missing && missing.signedIn && Array.isArray(missing.texts)) {
          for (const text of missing.texts.filter((t) => t.length >= 20)) {
            const r = await postJson("/api/extension/import", { token, text });
            added += Number(r.added) || 0;
          }
          for (const l of missing.links || []) {
            if (!todo.links.some((t) => t.href === l.href)) todo.links.push(l);
          }
        }
      }

      // Instructions and attached Docs for open work that has none yet.
      const links = needDetails.map((d) => ({
        href: `https://classroom.google.com/u/${account}/c/${d.classId}/a/${Buffer.from(String(d.id)).toString("base64").replace(/=+$/, "")}/details`,
        title: d.title,
        course: d.courseName,
      }));
      if (workRead === 0) links.push(...todo.links);
      const items = [];
      for (const link of links.slice(0, deep ? MAX_DETAILS : 12)) {
        await load(win, link.href);
        const detail = await run(win, READ_DETAIL).catch(() => null);
        if (!detail) continue;
        const docs = [];
        for (const [id, name] of Object.entries(detail.docs || {}).slice(0, 3)) {
          const text = await docText(id, account);
          if (text) docs.push({ name, text });
        }
        items.push({ title: link.title, courseName: link.course, pageText: detail.text, docs });
      }
      if (items.length > 0) {
        const r = await postJson("/api/desktop/details", { token, items });
        filled += Number(r.filled) || 0;
      }
      break;
    }

    lastSync = new Date();
    if (!found && !quiet) notify("No classes found", "Sign in to Classroom with your school account, then press Sync now.");
    else if (added > 0 || filled > 0 || turnedIn > 0 || !quiet) {
      notify(
        "Koptic is up to date",
        [
          added > 0 ? `${added} new from Classroom.` : "",
          turnedIn > 0 ? `${turnedIn} marked turned in.` : "",
          filled > 0 ? `Instructions added to ${filled}.` : "",
        ].filter(Boolean).join(" ") || "Nothing new in Classroom.",
      );
    }
  } catch (err) {
    logLine(`error: ${err && err.message ? err.message : err}`);
    if (!quiet) notify("Couldn't sync", String(err && err.message ? err.message : err));
  } finally {
    logLine(`done added=${added} turnedIn=${turnedIn} filled=${filled} found=${found}`);
    flushLog();
    syncing = false;
    updateTray();
  }
}

// ---------------- tray ----------------

function updateTray() {
  if (!tray) return;
  const startAtLogin = app.getLoginItemSettings().openAtLogin;
  tray.setToolTip(syncing ? "Koptic: syncing…" : "Koptic");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Koptic", click: () => showKoptic() },
      { label: syncing ? "Syncing…" : "Sync Classroom Now", enabled: !syncing, click: () => syncClassroom({ deep: true }) },
      { label: "Sign In to Classroom", click: signInToClassroom },
      { type: "separator" },
      {
        label: lastSync ? `Last synced ${lastSync.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not synced yet",
        enabled: false,
      },
      {
        label: process.platform === "darwin" ? "Open at Login" : process.platform === "win32" ? "Start with Windows" : "Start When I Log In",
        type: "checkbox",
        checked: startAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true, args: ["--hidden"] });
          updateTray();
        },
      },
      { type: "separator" },
      {
        label: "Quit Koptic",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ---------------- start ----------------

ipcMain.handle("koptic:paired", () => Boolean(readToken()));
ipcMain.handle("koptic:pair", (_e, token) => {
  if (typeof token !== "string" || token.length < 32 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) return false;
  saveToken(token);
  return true;
});
ipcMain.handle("koptic:sync", (_e, opts) => syncClassroom({ deep: Boolean(opts && opts.deep) }));
ipcMain.handle("koptic:classroom-signin", () => signInToClassroom());
ipcMain.handle("koptic:read-gdoc", async (_e, docId) => {
  if (typeof docId !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(docId)) return { error: "That isn't a Google Doc link." };
  // Every account signed in to the Classroom window, until one can open it.
  for (let account = 0; account < MAX_ACCOUNTS; account++) {
    const text = await docText(docId, account, 60000);
    if (text.trim()) return { text };
  }
  return { error: "None of the accounts signed in to Classroom here can open that doc." };
});

// ---------------- learning your routine ----------------
// Every couple of minutes, the names of the programs running go to Koptic,
// which keeps only the ones that mean an activity (a game, an editor, one of
// your activity apps) as "Valorant, 8:02 to 9:40". Nothing else is kept.
// Turn it off in Settings, Learn my routine.

const WATCH_EVERY_MS = 2 * 60 * 1000;
let watchPausedUntil = 0;

function runningPrograms() {
  return new Promise((resolve) => {
    const done = (err, out) =>
      resolve(err ? [] : [...new Set(String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean))]);
    if (process.platform === "win32") {
      execFile("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true, maxBuffer: 8e6 }, (err, out) =>
        done(err, String(out || "").split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1] || "").join("\n")),
      );
    } else {
      execFile("ps", ["-axo", "comm="], { maxBuffer: 8e6 }, (err, out) =>
        done(err, String(out || "").split("\n").map((l) => path.basename(l.trim())).join("\n")),
      );
    }
  });
}

async function watchActivities() {
  const token = readToken();
  if (!token || Date.now() < watchPausedUntil) return;
  const running = await runningPrograms();
  if (running.length === 0) return;
  try {
    const r = await postJson("/api/desktop/activity", { token, running });
    // Learn my routine is off: check again in a few hours in case it's back on.
    if (r && r.off) watchPausedUntil = Date.now() + 6 * 60 * 60 * 1000;
  } catch {
    // Offline or Koptic busy: the next check catches up.
  }
}

app.on("second-instance", () => showKoptic(null));

// ---------------- updates ----------------
// Installed copies check GitHub for a newer version, download it in the
// background and install it the next time Koptic restarts. Running from the
// folder (install.cmd / install.sh) skips this; git pull is the update there.
function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-downloaded", (info) => {
      notify("Koptic update ready", `Version ${info.version} installs next time Koptic restarts.`);
    });
    autoUpdater.on("error", (err) => logLine(`update error: ${err && err.message ? err.message : err}`));
    autoUpdater.checkForUpdates().catch(() => {});
  } catch {
    // Not installed with the updater (running from source): nothing to do.
  }
}

/** The tray picture: small enough for the Mac menu bar and Linux panels. */
function trayIcon() {
  const { nativeImage } = require("electron");
  const file = process.platform === "win32" ? "icon.png" : "tray.png";
  let img = nativeImage.createFromPath(path.join(__dirname, file));
  if (process.platform === "darwin") img = img.resize({ width: 18, height: 18 });
  return img;
}

app.whenReady().then(() => {
  logLine("Koptic Desktop started (sync log version 4)");
  flushLog();
  if (process.platform === "win32") app.setAppUserModelId("app.koptic.desktop");
  tray = new Tray(trayIcon());
  tray.on("click", () => showKoptic(null));
  updateTray();

  const startedHidden =
    process.argv.includes("--hidden") ||
    (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAsHidden);
  if (!startedHidden) showKoptic(readToken() ? "/today" : "/connect/classroom");
  setTimeout(() => syncClassroom({ quiet: true }), 30_000);
  setInterval(() => syncClassroom({ quiet: true }), SYNC_EVERY_MS);
  setTimeout(watchActivities, 60_000);
  setInterval(watchActivities, WATCH_EVERY_MS);
  setTimeout(checkForUpdates, 15_000);
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
});

// On a Mac, clicking the Dock icon with no window open brings Koptic back.
app.on("activate", () => showKoptic(null));

// Keep running in the tray when every window is closed.
app.on("window-all-closed", () => {});
