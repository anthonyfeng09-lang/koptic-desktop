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
  const SECTION = /(no due date|this week|next week|later|earlier)/i;
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
  for (let i = 0; i < 16 && (main().innerText || "").length < 80; i++) await sleep(500);
  await sleep(600);
  const docs = {};
  for (const a of main().querySelectorAll('a[href*="docs.google.com/document/d/"]')) {
    const m = a.href.match(/document\\/d\\/([A-Za-z0-9_-]{20,})/);
    if (m && !docs[m[1]]) docs[m[1]] = (a.innerText || a.getAttribute("aria-label") || "").split("\\n")[0].trim();
  }
  return { text: (main().innerText || "").slice(0, 60000), docs };
})()`;
