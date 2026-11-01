/**
 * Code the app runs inside its own Classroom window. Kept as strings because
 * they execute in the page, not in Node. Both only read; neither clicks
 * anything except To-do's own section headers (to open them).
 */

/** The To-do page: every section's text, plus a link to each assignment. */
exports.READ_TODO = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (location.hostname !== "classroom.google.com") return { signedIn: false };
  for (let i = 0; i < 20 && !document.querySelector('a[href*="/c/"]'); i++) await sleep(500);
  if (!document.querySelector('a[href*="/c/"]')) return { signedIn: true, hasClasses: false };

  const main = document.querySelector("[role=main]") || document.body;
  const text = () => (main.innerText || "").replace(/\\r\\n?/g, "\\n").trim();
  const SECTION = /(no due date|this week|next week|last week|later|earlier)/i;
  for (let i = 0; i < 16 && !SECTION.test(text()); i++) await sleep(500);

  const links = new Map();
  const grab = () => {
    for (const a of main.querySelectorAll('a[href*="/a/"]')) {
      const m = a.href.match(/\\/c\\/[^/]+\\/a\\/[^/?#]+/);
      if (!m) continue;
      const lines = (a.innerText || "").split("\\n").map((s) => s.trim()).filter(Boolean);
      if (lines.length === 0) continue;
      links.set(m[0], { href: a.href, title: lines[0], course: lines[1] || "" });
    }
  };

  const texts = [];
  const toggles = Array.from(main.querySelectorAll("[aria-expanded]")).filter(
    (el) => el.offsetParent !== null && SECTION.test(el.innerText || el.getAttribute("aria-label") || ""),
  );
  if (toggles.length === 0) {
    texts.push(text());
    grab();
  }
  for (const t of toggles) {
    if (t.getAttribute("aria-expanded") !== "true") {
      try { t.click(); } catch {}
      await sleep(900);
    }
    texts.push(text());
    grab();
  }
  return { signedIn: true, hasClasses: true, texts, links: Array.from(links.values()).slice(0, 40) };
})()`;

/** One assignment page: its text and any Google Docs attached. */
exports.READ_DETAIL = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const main = () => document.querySelector("[role=main]") || document.body;
  // The page shell ("Skip to main content…") shows before the assignment
  // does, so wait for the real main area to fill.
  const ready = () => {
    const m = document.querySelector("[role=main]");
    return m && (m.innerText || "").length > 120;
  };
  for (let i = 0; i < 30 && !ready(); i++) await sleep(500);
  await sleep(600);
  const docs = {};
  for (const a of main().querySelectorAll('a[href*="docs.google.com/document/d/"]')) {
    const m = a.href.match(/document\\/d\\/([A-Za-z0-9_-]{20,})/);
    if (m && !docs[m[1]]) docs[m[1]] = (a.innerText || a.getAttribute("aria-label") || "").split("\\n")[0].trim();
  }
  return { text: (main().innerText || "").slice(0, 60000), docs };
})()`;

/** Classroom's home page: every class the student is enrolled in, by name,
 *  plus the link to its "Your work" page. The cleanest name is in that
 *  link's label: Open your work for "Maple Minds". */
exports.READ_CLASSES = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (location.hostname !== "classroom.google.com") return { signedIn: false, classes: [] };
  for (let i = 0; i < 20 && !document.querySelector('a[href*="/c/"]'); i++) await sleep(500);
  await sleep(800);
  const byId = new Map();
  const work = new Map();
  for (const a of document.querySelectorAll('a[href*="/sp/"]')) {
    const m = (a.getAttribute("href") || "").match(/\\/c\\/([A-Za-z0-9_-]+)\\/sp\\//);
    const label = (a.getAttribute("aria-label") || "").match(/"(.+)"\\s*$/);
    if (!m) continue;
    work.set(m[1], a.getAttribute("href"));
    if (label && label[1].trim().length > 1) byId.set(m[1], label[1].trim());
  }
  for (const a of document.querySelectorAll('a[href*="/c/"]')) {
    const m = (a.getAttribute("href") || "").match(/\\/c\\/([A-Za-z0-9_-]+)\\/?(?:[?#]|$)/);
    if (!m || byId.has(m[1])) continue;
    // Read the link's text pieces one by one. innerText glues the avatar
    // letter, the name and the section together ("MMaple Athletics",
    // "MPM2DZ_2627_S1Period 1"); the name is the first piece longer than
    // one letter.
    const parts = [];
    const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const t = (walk.currentNode.textContent || "").replace(/\\s+/g, " ").trim();
      if (t) parts.push(t);
    }
    const first = parts.find((s) => s.length > 1) || (a.getAttribute("aria-label") || "").trim();
    if (!first || first.length < 2) continue;
    byId.set(m[1], first);
  }
  return {
    signedIn: true,
    classes: Array.from(byId.entries()).map(([id, name]) => ({ id, name, workHref: work.get(id) || null })),
  };
})()`;

/** One class's "Your work" page: every assignment with its due date and
 *  status. Rows load as you scroll, so scroll until no new ones appear. */
exports.READ_WORK = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (location.hostname !== "classroom.google.com") return { signedIn: false, items: [] };
  const rows = () =>
    Array.from(document.querySelectorAll("[data-stream-item-id]")).filter(
      (e) => !(e.parentElement && e.parentElement.closest("[data-stream-item-id]")),
    );
  const main = () => document.querySelector("[role=main]") || document.body;
  for (let i = 0; i < 20 && rows().length === 0 && !/see all your assignments/i.test(main().innerText || ""); i++) await sleep(500);
  let last = -1;
  for (let i = 0; i < 25 && rows().length !== last; i++) {
    last = rows().length;
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
    }
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(800);
  }
  const items = rows().map((r) => {
    const lines = (r.innerText || "")
      .split("\\n")
      .map((s) => s.trim())
      .filter((s) => s && !/^(attach_file|\\d+|\\d+ (submission )?attachments?)$/i.test(s));
    const rest = lines.slice(1);
    const due = rest.find((s) => /^(due\\b|no due date)/i.test(s)) || null;
    const status =
      rest.find((s) => /^(assigned|turned in|handed in|missing|done|done late|graded|returned|not turned in|\\d+(\\.\\d+)?\\s*\\/\\s*\\d+)/i.test(s)) || null;
    return { id: r.getAttribute("data-stream-item-id"), title: lines[0] || "", due, status };
  });
  return { signedIn: true, items };
})()`;
