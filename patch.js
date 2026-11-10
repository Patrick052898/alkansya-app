#!/usr/bin/env node
/*
 * Alkansya patcher: fixes "Add category" not working.
 *
 * Cause: server.js ignored the customCategories field when saving, so a new
 * category was thrown away right after you added it.
 *
 * Usage (from your project folder, next to server.js):
 *   node patch-categories.js
 *   node patch-categories.js path/to/server.js
 *
 * Makes a backup (server.js.bak-categories) first. Safe to run twice.
 * Only server.js changes - redeploy it afterwards.
 */
const fs = require("fs");
const path = require("path");

const file = process.argv[2] || "server.js";
if (!fs.existsSync(file)) {
  console.error("Could not find " + file + ". Run this from your project folder, or pass the path.");
  process.exit(1);
}

const original = fs.readFileSync(file);
let src = original.toString("utf8");
const crlf = src.includes("\r\n");
if (crlf) src = src.replace(/\r\n/g, "\n");

if (src.includes("customCategories")) {
  console.log("Already patched: " + file);
  process.exit(0);
}

function replaceOnce(label, find, replacement) {
  const count = src.split(find).length - 1;
  if (count !== 1) {
    console.error("FAILED on '" + label + "': expected 1 match, found " + count + ". Nothing was changed.");
    process.exit(1);
  }
  src = src.replace(find, () => replacement);
}

replaceOnce(
  "read customCategories from body",
  "const { entries, budgets, members, recurringBills, settings } = req.body || {};",
  "const { entries, budgets, members, recurringBills, settings, customCategories } = req.body || {};"
);
replaceOnce(
  "save customCategories",
  "    if (settings !== undefined) household.settings = settings;\n",
  "    if (settings !== undefined) household.settings = settings;\n" +
  "    if (customCategories !== undefined) household.customCategories = customCategories;\n"
);

fs.writeFileSync(file + ".bak-categories", original);
fs.writeFileSync(file, crlf ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("Patched " + path.resolve(file));
console.log("Backup saved as " + file + ".bak-categories");