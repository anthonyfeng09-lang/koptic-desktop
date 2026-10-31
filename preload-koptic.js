/**
 * Runs inside the Koptic window. Answers the Connect Classroom page the same
 * way the Chrome extension does (ping, pair, first-sync), so the page works
 * unchanged and the app gets this account's token without anything to copy.
 * Only the real Koptic origin, only on /connect/ pages.
 */
const { ipcRenderer } = require("electron");

const KOPTIC_ORIGIN = "https://koptic.vercel.app";
const VERSION = "desktop-0.1.0";

function reply(data) {
  window.postMessage({ source: "koptic-extension", version: VERSION, ...data }, KOPTIC_ORIGIN);
}

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== KOPTIC_ORIGIN) return;
  if (!location.pathname.startsWith("/connect/")) return;
  const msg = event.data;
  if (!msg || msg.source !== "koptic-page" || typeof msg.type !== "string") return;

  if (msg.type === "ping") {
    reply({ type: "pong", paired: await ipcRenderer.invoke("koptic:paired") });
    return;
  }
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
