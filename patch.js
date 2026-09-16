#!/usr/bin/env node
/*
 * patch-alkansya.js
 *
 * Fixes the "Uncaught SyntaxError: Unexpected identifier 's'" blank-page bug.
 *
 * Cause: two JS string literals are wrapped in single quotes but contain an
 * unescaped apostrophe ("household's", "member's"). The apostrophe closes the
 * string early and the remainder is parsed as code, so the entire inline
 * <script> fails to compile and no UI ever renders.
 *
 * Usage:
 *   node patch-alkansya.js                 (auto-finds index.html)
 *   node patch-alkansya.js path/to/index.html
 *
 * Safe to run more than once. Writes a .bak before changing anything.
 */

const fs = require("fs");
const path = require("path");

// Each fix is matched on the raw broken text. `find` must be absent after a
// successful patch, which is what makes re-runs a no-op instead of a mangle.
const FIXES = [
  {
    label: "household's -> household\\'s",
    find: "the household's shared data",
    replace: "the household\\'s shared data",
  },
  {
    label: "member's -> member\\'s",
    find: "Each member's contribution",
    replace: "Each member\\'s contribution",
  },
];

const CANDIDATES = [
  "public/index.html",
  "index.html",
  "src/index.html",
  "dist/index.html",
  "www/index.html",
];

function locate() {
  const fromArg = process.argv[2];
  if (fromArg) {
    const p = path.resolve(fromArg);
    if (!fs.existsSync(p)) fail("No file at " + p);
    return p;
  }
  for (const c of CANDIDATES) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) return p;
  }
  fail(
    "Could not find index.html. Looked in:\n  " +
      CANDIDATES.join("\n  ") +
      "\nRun from your project root, or pass the path:\n" +
      "  node patch-alkansya.js public/index.html"
  );
}

function fail(msg) {
  console.error("\n  FAILED\n  " + msg + "\n");
  process.exit(1);
}

// Compile every inline <script> to confirm the file is actually valid JS.
function checkScripts(html) {
  const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const line = html.slice(0, m.index).split("\n").length;
    try {
      new Function(m[1]);
    } catch (e) {
      return { ok: false, line, message: e.message };
    }
  }
  return { ok: true };
}

function main() {
  const file = locate();
  console.log("\n  Alkansya patcher");
  console.log("  target: " + file);

  const original = fs.readFileSync(file, "utf8");
  let html = original;
  const applied = [];
  const skipped = [];

  for (const fix of FIXES) {
    if (html.indexOf(fix.find) !== -1) {
      html = html.split(fix.find).join(fix.replace);
      applied.push(fix.label);
    } else {
      skipped.push(fix.label);
    }
  }

  if (applied.length === 0) {
    console.log("\n  Nothing to change - already patched.");
    const verify = checkScripts(html);
    if (!verify.ok) {
      console.log(
        "\n  WARNING: a different syntax error remains near line " +
          verify.line +
          ":\n  " +
          verify.message
      );
    } else {
      console.log("  Inline scripts parse cleanly.\n");
    }
    return;
  }

  const verify = checkScripts(html);
  if (!verify.ok) {
    fail(
      "Patch applied but the file still has a syntax error near line " +
        verify.line +
        ":\n  " +
        verify.message +
        "\n  Nothing was written - your file is untouched."
    );
  }

  const backup = file + ".bak";
  fs.writeFileSync(backup, original, "utf8");
  fs.writeFileSync(file, html, "utf8");

  console.log("\n  Applied:");
  applied.forEach((a) => console.log("    + " + a));
  if (skipped.length) {
    skipped.forEach((s) => console.log("    . " + s + " (already fixed)"));
  }
  console.log("\n  Backup: " + backup);
  console.log("  Inline scripts parse cleanly.");
  console.log("\n  Restart the server and hard-reload (Ctrl+Shift+R).\n");
}

main();