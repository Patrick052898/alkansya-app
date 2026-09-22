#!/usr/bin/env node
/*
 * patch-alkansya-form-reset.js
 *
 * Fixes: the "Add entry" form (Amount / Note / Date) getting wiped a
 * couple of seconds after you start typing.
 *
 * Cause: the dashboard polls GET /api/households/:code every 4 seconds
 * so other household members' changes show up without a manual refresh
 * (see index.html, subscribeHousehold()). Every single poll - even a
 * silent background one - calls render() -> renderDashboard(), which
 * rebuilds the *entire* dashboard by replacing root.innerHTML, including
 * the "Add entry" form. That wipes out whatever you'd typed into
 * Amount/Note and resets the Date field back to today, even though you
 * never touched submit.
 *
 * Fix: right before renderDashboard() rebuilds the HTML, it now snapshots
 * the current form field values (and which field had focus + cursor
 * position). Right after the rebuild, it restores them. Background polls
 * become invisible to whatever you're mid-typing, while still pulling in
 * new entries from other members.
 *
 * Usage:
 *   node patch-alkansya-form-reset.js                   (auto-finds index.html)
 *   node patch-alkansya-form-reset.js path/to/index.html
 *
 * Safe to run more than once - it detects whether it's already patched
 * and does nothing in that case. Writes index.html.bak before changing
 * anything, and verifies the result still parses as valid JavaScript
 * before keeping it.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CANDIDATES = ["public/index.html", "index.html", "src/public/index.html"];

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
      "  node patch-alkansya-form-reset.js public/index.html"
  );
}

// Each edit is a unique anchor string to find and what to replace it with.
// If an anchor isn't found exactly once, nothing is written (fails safe).
const EDITS = [
  {
    name: "capture form values before rebuilding the dashboard",
    find:
      "  function renderDashboard() {\n" +
      "    var d = computeMonthData();\n" +
      "    var showMembers = (household.members || []).length > 1;\n" +
      "\n" +
      "    root.innerHTML =",
    replace:
      "  function renderDashboard() {\n" +
      "    var d = computeMonthData();\n" +
      "    var showMembers = (household.members || []).length > 1;\n" +
      "\n" +
      "    // Snapshot whatever is currently in the Add-entry form (and which\n" +
      "    // field, if any, has focus) so a background poll refresh below\n" +
      "    // doesn't wipe out text the user is mid-typing.\n" +
      "    var preservedForm = null;\n" +
      "    var existingForm = document.getElementById(\"entry-form\");\n" +
      "    if (existingForm) {\n" +
      "      var pAmt = document.getElementById(\"f-amount\");\n" +
      "      var pNote = document.getElementById(\"f-note\");\n" +
      "      var pDate = document.getElementById(\"f-date\");\n" +
      "      var active = document.activeElement;\n" +
      "      preservedForm = {\n" +
      "        amount: pAmt ? pAmt.value : \"\",\n" +
      "        note: pNote ? pNote.value : \"\",\n" +
      "        date: pDate && pDate.value ? pDate.value : todayISO(),\n" +
      "        focusedId: active && active.id,\n" +
      "        selectionStart: active && typeof active.selectionStart === \"number\" ? active.selectionStart : null,\n" +
      "        selectionEnd: active && typeof active.selectionEnd === \"number\" ? active.selectionEnd : null\n" +
      "      };\n" +
      "    }\n" +
      "\n" +
      "    root.innerHTML ="
  },
  {
    name: "stop resetting the Date field to today on every rebuild",
    find:
      "'<label class=\"field\">Date<input class=\"input\" type=\"date\" id=\"f-date\" value=\"' + todayISO() + '\" /></label>' +",
    replace:
      "'<label class=\"field\">Date<input class=\"input\" type=\"date\" id=\"f-date\" value=\"' + (preservedForm ? preservedForm.date : todayISO()) + '\" /></label>' +"
  },
  {
    name: "restore form values and focus after the rebuild",
    find:
      "      '</div>';\n" +
      "\n" +
      "    document.getElementById(\"logout-btn\").onclick = handleLogout;",
    replace:
      "      '</div>';\n" +
      "\n" +
      "    // Put back whatever the user had typed and which field they were in,\n" +
      "    // now that the fresh HTML (possibly from a background poll) is in place.\n" +
      "    if (preservedForm) {\n" +
      "      var rAmt = document.getElementById(\"f-amount\");\n" +
      "      var rNote = document.getElementById(\"f-note\");\n" +
      "      if (rAmt) rAmt.value = preservedForm.amount;\n" +
      "      if (rNote) rNote.value = preservedForm.note;\n" +
      "      if (preservedForm.focusedId) {\n" +
      "        var toFocus = document.getElementById(preservedForm.focusedId);\n" +
      "        if (toFocus) {\n" +
      "          toFocus.focus();\n" +
      "          if (preservedForm.selectionStart !== null && toFocus.setSelectionRange) {\n" +
      "            try { toFocus.setSelectionRange(preservedForm.selectionStart, preservedForm.selectionEnd); } catch (e) {}\n" +
      "          }\n" +
      "        }\n" +
      "      }\n" +
      "    }\n" +
      "\n" +
      "    document.getElementById(\"logout-btn\").onclick = handleLogout;"
  }
];

function extractInlineScript(html) {
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start);
  if (start === -1 || end === -1) return null;
  return html.slice(start + "<script>".length, end);
}

function checkSyntax(js) {
  try {
    new vm.Script(js);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function main() {
  const file = locate();
  console.log("\n  Alkansya form-reset patcher");
  console.log("  target: " + file);

  const original = fs.readFileSync(file, "utf8");

  if (original.indexOf("preservedForm") !== -1) {
    console.log("\n  Nothing to change - already patched.\n");
    return;
  }

  let content = original;
  for (const edit of EDITS) {
    const count = content.split(edit.find).length - 1;
    if (count === 0) {
      fail(
        'Could not find the expected code for "' + edit.name + '".\n' +
          "  index.html looks different than expected (hand-edited?) - nothing was written."
      );
    }
    if (count > 1) {
      fail(
        'Found more than one match for "' + edit.name + '" - refusing to guess which one.\n' +
          "  Nothing was written."
      );
    }
    content = content.replace(edit.find, edit.replace);
  }

  const script = extractInlineScript(content);
  if (!script) {
    fail("Could not find the inline <script> block to verify - nothing was written.");
  }
  const verify = checkSyntax(script);
  if (!verify.ok) {
    fail("Internal error: patched script does not parse: " + verify.message);
  }

  const backup = file + ".bak";
  fs.writeFileSync(backup, original, "utf8");
  fs.writeFileSync(file, content, "utf8");

  console.log("\n  Patched " + path.basename(file) + " - the Add-entry form now survives");
  console.log("  background polling instead of getting wiped while you type.");
  console.log("  Backup: " + backup);
  console.log("\n  Just refresh the page (or redeploy) to pick up the change.\n");
}

main();
