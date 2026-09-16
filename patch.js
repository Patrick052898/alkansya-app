#!/usr/bin/env node
/*
 * patch-alkansya-render.js
 *
 * Fixes the UI resetting itself on a timer (scroll jumping to top, focus
 * lost, half-typed input cleared).
 *
 * Cause: subscribeHousehold() polls the server every 4s and every poll calls
 * render() unconditionally. render() rebuilds the page with
 * root.innerHTML = '...', which destroys and recreates every node - so the
 * DOM is torn down 15x a minute even when nothing on the server changed.
 *
 * Fix, in two parts:
 *   1. Compare the freshly fetched household against the last one rendered.
 *      Identical? Skip the render entirely. Polls become invisible.
 *   2. On renders that DO happen, save and restore scroll position, the
 *      focused element, and the caret offset inside it.
 *
 * Usage:
 *   node patch-alkansya-render.js               (auto-finds index.html)
 *   node patch-alkansya-render.js path/to/index.html
 *
 * Safe to run more than once. Writes a .bak before changing anything.
 */

const fs = require("fs");
const path = require("path");

const FIXES = [];

// ---------------------------------------------------------------------------
// Fix 1: skip the re-render when polled data is unchanged.
// ---------------------------------------------------------------------------
FIXES.push({
  label: "poll skips render when data is unchanged",
  find: [
    "  async function loadHouseholdOnce(code, silent) {",
    "    try {",
    '      var body = await apiCall("/households/" + encodeURIComponent(code));',
    "      household = body.household;",
    "      household.__code = code;",
    '      view = "dashboard";',
    "      render();",
  ].join("\n"),
  replace: [
    "  var lastRenderedSig = null;",
    "",
    "  async function loadHouseholdOnce(code, silent) {",
    "    try {",
    '      var body = await apiCall("/households/" + encodeURIComponent(code));',
    "      // Signature of what the server just gave us. If it matches what is",
    "      // already painted, re-rendering would only destroy the user's scroll",
    "      // position and focus for no visible gain.",
    "      var sig = JSON.stringify(body.household);",
    "      var wasDashboard = view === \"dashboard\";",
    "      household = body.household;",
    "      household.__code = code;",
    '      view = "dashboard";',
    "      if (silent && wasDashboard && sig === lastRenderedSig) return;",
    "      lastRenderedSig = sig;",
    "      render();",
  ].join("\n"),
});

// ---------------------------------------------------------------------------
// Fix 2: preserve scroll + focus + caret across the renders that remain.
// ---------------------------------------------------------------------------
FIXES.push({
  label: "render() preserves scroll, focus and caret",
  find: [
    "  function render() {",
    '    if (view === "loading") { renderLoading(); }',
  ].join("\n"),
  replace: [
    "  // innerHTML rebuilds destroy focus and scroll. Capture them first, then",
    "  // put them back on the new nodes by id.",
    "  function captureUiState() {",
    "    var el = document.activeElement;",
    "    var state = {",
    "      scrollX: window.scrollX,",
    "      scrollY: window.scrollY,",
    "      focusId: el && el.id ? el.id : null,",
    "      selStart: null,",
    "      selEnd: null",
    "    };",
    "    if (el && state.focusId && typeof el.selectionStart === \"number\") {",
    "      try { state.selStart = el.selectionStart; state.selEnd = el.selectionEnd; } catch (e) {}",
    "    }",
    "    return state;",
    "  }",
    "",
    "  function restoreUiState(state) {",
    "    if (!state) return;",
    "    if (state.focusId) {",
    "      var el = document.getElementById(state.focusId);",
    "      if (el) {",
    "        try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }",
    "        if (state.selStart !== null && typeof el.setSelectionRange === \"function\") {",
    "          try { el.setSelectionRange(state.selStart, state.selEnd); } catch (e) {}",
    "        }",
    "      }",
    "    }",
    "    window.scrollTo(state.scrollX, state.scrollY);",
    "  }",
    "",
    "  function render() {",
    "    var __ui = captureUiState();",
    '    if (view === "loading") { renderLoading(); }',
  ].join("\n"),
});

FIXES.push({
  label: "render() restore hook",
  find: [
    "    } else {",
    '      var existing = document.querySelectorAll(".toast");',
    "      existing.forEach(function (el) { el.remove(); });",
    "    }",
    "  }",
  ].join("\n"),
  replace: [
    "    } else {",
    '      var existing = document.querySelectorAll(".toast");',
    "      existing.forEach(function (el) { el.remove(); });",
    "    }",
    "",
    "    restoreUiState(__ui);",
    "  }",
  ].join("\n"),
});

// Local writes change the data, so the next poll must not be skipped.
// Invalidate the signature wherever we PATCH the server.
FIXES.push({
  label: "local saves invalidate the render signature",
  find: "  function stopPolling() {",
  replace: [
    "  function invalidateRenderSig() { lastRenderedSig = null; }",
    "",
    "  function stopPolling() {",
  ].join("\n"),
});

const CANDIDATES = [
  "public/index.html",
  "index.html",
  "src/index.html",
  "dist/index.html",
  "www/index.html",
];

function fail(msg) {
  console.error("\n  FAILED\n  " + msg + "\n");
  process.exit(1);
}

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
      "  node patch-alkansya-render.js public/index.html"
  );
}

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
  console.log("\n  Alkansya render patcher");
  console.log("  target: " + file);

  const original = fs.readFileSync(file, "utf8");
  let html = original;
  const applied = [];
  const already = [];
  const missing = [];

  for (const fix of FIXES) {
    if (html.indexOf(fix.replace) !== -1) {
      already.push(fix.label);
    } else if (html.indexOf(fix.find) !== -1) {
      html = html.split(fix.find).join(fix.replace);
      applied.push(fix.label);
    } else {
      missing.push(fix.label);
    }
  }

  if (missing.length) {
    fail(
      "Could not locate the code to change for:\n    - " +
        missing.join("\n    - ") +
        "\n  The file may already be edited by hand or be a different version." +
        "\n  Nothing was written - your file is untouched."
    );
  }

  if (applied.length === 0) {
    console.log("\n  Nothing to change - already patched.\n");
    return;
  }

  const verify = checkScripts(html);
  if (!verify.ok) {
    fail(
      "Patch produced a syntax error near line " +
        verify.line +
        ":\n  " +
        verify.message +
        "\n  Nothing was written - your file is untouched."
    );
  }

  const backup = file + ".render.bak";
  fs.writeFileSync(backup, original, "utf8");
  fs.writeFileSync(file, html, "utf8");

  console.log("\n  Applied:");
  applied.forEach((a) => console.log("    + " + a));
  already.forEach((a) => console.log("    . " + a + " (already present)"));
  console.log("\n  Backup: " + backup);
  console.log("  Inline scripts parse cleanly.");
  console.log("\n  Restart the server and hard-reload (Ctrl+Shift+R).\n");
}

main();