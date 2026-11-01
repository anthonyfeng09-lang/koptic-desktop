/**
 * Runs inside the Koptic window. Answers the Connect Classroom page the same
 * way the Chrome extension does (ping, pair, first-sync), so the page works
 * unchanged and the app gets this account's token without anything to copy.
 * Only the real Koptic origin, only on /connect/ pages.
 */
const { ipcRenderer } = require("electron");

const KOPTIC_ORIGIN = "https://koptic.vercel.app";
const VERSION = "desktop-0.2.3";

function reply(data) {
  window.postMessage({ source: "koptic-extension", version: VERSION, ...data }, KOPTIC_ORIGIN);
}

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== KOPTIC_ORIGIN) return;
  const msg = event.data;
  if (!msg || msg.source !== "koptic-page" || typeof msg.type !== "string") return;
  const id = typeof msg.id === "string" ? msg.id.slice(0, 40) : undefined;

  // Any Koptic page can ask whether it's in the desktop app.
  if (msg.type === "ping") {
    reply({ type: "pong", id, paired: await ipcRenderer.invoke("koptic:paired") });
    return;
  }
  // Check My Draft reads the student's own Google Doc through the school
  // account signed in here, so private docs work. Read only.
  if (msg.type === "read-gdoc" && location.pathname.startsWith("/assignments/")) {
    const docId = typeof msg.docId === "string" ? msg.docId : "";
    const result = await ipcRenderer.invoke("koptic:read-gdoc", docId);
    reply({ type: "gdoc-text", id, ...result });
    return;
  }

  // Pairing and syncing stay on the Connect pages.
  if (!location.pathname.startsWith("/connect/")) return;
  if (msg.type === "pair") {
    const token = typeof msg.token === "string" ? msg.token.trim() : "";
    const ok = await ipcRenderer.invoke("koptic:pair", token);
    reply({ type: "pair-result", ok });
    return;
  }
  if (msg.type === "classroom-signin") {
    ipcRenderer.invoke("koptic:classroom-signin");
    return;
  }
  if (msg.type === "first-sync") {
    ipcRenderer.invoke("koptic:sync", { deep: true });
    reply({ type: "first-sync-started" });
  }
});

window.addEventListener("DOMContentLoaded", () => {
  if (location.origin === KOPTIC_ORIGIN) reply({ type: "hello" });
});
