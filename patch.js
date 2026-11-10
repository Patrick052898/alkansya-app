#!/usr/bin/env node
/*
 * Alkansya patcher: joining with a name that already exists in the household
 * (case-insensitive) signs you back in as that member instead of creating a
 * duplicate.
 *
 * Patches TWO files: server.js and public/index.html
 *
 * Usage (from your project folder, next to server.js):
 *   node patch-rejoin.js
 *   node patch-rejoin.js path/to/server.js path/to/index.html
 *
 * Makes backups (*.bak-rejoin) first. Safe to run twice.
 */
const fs = require("fs");
const path = require("path");

const serverPath = process.argv[2] || (fs.existsSync("server.js") ? "server.js" : null);
const htmlPath =
  process.argv[3] || ["public/index.html", "index.html"].find((p) => fs.existsSync(p));

if (!serverPath || !fs.existsSync(serverPath)) {
  console.error("Could not find server.js. Run this from your project folder.");
  process.exit(1);
}
if (!htmlPath || !fs.existsSync(htmlPath)) {
  console.error("Could not find index.html (looked in public/index.html and index.html).");
  process.exit(1);
}

function load(file) {
  let text = fs.readFileSync(file, "utf8");
  const crlf = text.includes("\r\n");
  if (crlf) text = text.replace(/\r\n/g, "\n");
  return { file, text, crlf, original: fs.readFileSync(file) };
}

function replaceOnce(doc, label, find, replacement) {
  const count = doc.text.split(find).length - 1;
  if (count !== 1) {
    console.error("FAILED on '" + label + "' in " + doc.file + ": expected 1 match, found " + count + ". Nothing was changed.");
    process.exit(1);
  }
  doc.text = doc.text.replace(find, () => replacement);
}

const server = load(serverPath);
const html = load(htmlPath);

if (server.text.includes("__rejoin_fix_v1__") && html.text.includes("body.rejoined")) {
  console.log("Already patched.");
  process.exit(0);
}

// ---- server.js: reuse existing member on join ----
replaceOnce(
  server,
  "server join route",
  `    const viewerId = uid();
    household.members.push({ id: viewerId, displayName: displayName.trim() });
    await store.saveHousehold(household);
    res.json({ code, viewerId, household });`,
  `    // __rejoin_fix_v1__
    const wanted = displayName.trim();
    const existing = (household.members || []).find(
      (m) => String(m.displayName || "").trim().toLowerCase() === wanted.toLowerCase()
    );
    if (existing) {
      // Same name (any upper/lower case): sign back in as that member, no duplicate.
      return res.json({ code, viewerId: existing.id, displayName: existing.displayName, rejoined: true, household });
    }
    const viewerId = uid();
    household.members.push({ id: viewerId, displayName: wanted });
    await store.saveHousehold(household);
    res.json({ code, viewerId, displayName: wanted, rejoined: false, household });`
);

// ---- index.html: use the existing member's name/id ----
replaceOnce(
  html,
  "client saveProfile",
  "saveProfile({ householdCode: code, viewerId: body.viewerId, displayName: displayName.trim() });",
  "saveProfile({ householdCode: code, viewerId: body.viewerId, displayName: body.displayName || displayName.trim() });"
);
replaceOnce(
  html,
  "client toast",
  'showToast("Joined " + body.household.name + "!");',
  'showToast((body.rejoined ? "Welcome back to " : "Joined ") + body.household.name + "!");'
);

for (const doc of [server, html]) {
  fs.writeFileSync(doc.file + ".bak-rejoin", doc.original);
  fs.writeFileSync(doc.file, doc.crlf ? doc.text.replace(/\n/g, "\r\n") : doc.text, "utf8");
  console.log("Patched " + path.resolve(doc.file) + "  (backup: " + doc.file + ".bak-rejoin)");
}