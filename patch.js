#!/usr/bin/env node
/*
 * Alkansya patcher: stops the Add-entry form from resetting while typing.
 *
 * Usage (from your project folder):
 *   node patch-index.js                 -> auto-finds public/index.html or index.html
 *   node patch-index.js path/to/index.html
 *
 * Makes a backup (index.html.bak) first. Safe to run twice.
 */
const fs = require("fs");
const path = require("path");

const arg = process.argv[2];
const candidates = arg ? [arg] : ["public/index.html", "index.html"];
const target = candidates.find((p) => fs.existsSync(p));
if (!target) {
  console.error("Could not find index.html. Pass the path: node patch-index.js path/to/index.html");
  process.exit(1);
}

let src = fs.readFileSync(target, "utf8");
const hadCRLF = src.includes("\r\n");
if (hadCRLF) src = src.replace(/\r\n/g, "\n");

if (src.includes("__typing_fix_v1__")) {
  console.log("Already patched: " + target);
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

// 1) Draft store + "last data seen" signature + input tracking
replaceOnce(
  "declare helpers",
  '  var pollTimer = null;\n',
  '  var pollTimer = null;\n' +
  '  // __typing_fix_v1__\n' +
  '  var lastHouseholdSig = null; // JSON of the last household data we rendered\n' +
  '  var draft = { amount: "", note: "" }; // what the user has typed in Add entry\n' +
  '  document.addEventListener("input", function (e) {\n' +
  '    var id = e.target && e.target.id;\n' +
  '    if (id === "f-amount") draft.amount = e.target.value;\n' +
  '    else if (id === "f-note") draft.note = e.target.value;\n' +
  '  });\n'
);

// 2) Background poll: do NOT re-render if nothing changed on the server
replaceOnce(
  "poll skip-if-unchanged",
  '      household = body.household;\n      household.__code = code;\n      view = "dashboard";\n',
  '      var sig = JSON.stringify(body.household);\n' +
  '      var unchanged = !!(silent && view === "dashboard" && household && sig === lastHouseholdSig);\n' +
  '      lastHouseholdSig = sig;\n' +
  '      household = body.household;\n' +
  '      household.__code = code;\n' +
  '      view = "dashboard";\n' +
  '      if (unchanged) return; // nothing new -> leave the form alone\n'
);

// 3) When a render does happen, restore from the draft if the DOM value is empty
replaceOnce(
  "preserve amount/note",
  '        amount: pAmt ? pAmt.value : "",\n        note: pNote ? pNote.value : "",\n',
  '        amount: pAmt && pAmt.value !== "" ? pAmt.value : draft.amount,\n' +
  '        note: pNote && pNote.value !== "" ? pNote.value : draft.note,\n'
);

// 4) Clear the draft after a successful add
replaceOnce(
  "clear draft on submit",
  '        document.getElementById("f-amount").value = "";\n        document.getElementById("f-note").value = "";\n',
  '        document.getElementById("f-amount").value = "";\n' +
  '        document.getElementById("f-note").value = "";\n' +
  '        draft.amount = ""; draft.note = "";\n'
);

fs.writeFileSync(target + ".bak", fs.readFileSync(target));
if (hadCRLF) src = src.replace(/\n/g, "\r\n");
fs.writeFileSync(target, src, "utf8");
console.log("Patched " + path.resolve(target));
console.log("Backup saved as " + target + ".bak");