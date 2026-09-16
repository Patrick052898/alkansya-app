#!/usr/bin/env node
/**
 * patch-alkansya.js
 * ------------------
 * Automatically patches your Alkansya app in place:
 *   1. Translates the UI (public/index.html) from Filipino to English.
 *   2. Fixes a bug where joining with a bad household code, or the API
 *      being unreachable (e.g. backend not running), showed a vague
 *      "something went wrong" message instead of a clear one.
 *
 * Usage:
 *   node patch-alkansya.js
 *   node patch-alkansya.js path/to/index.html path/to/server.js
 *
 * If you don't pass paths, it looks for:
 *   ./public/index.html  (falls back to ./index.html)
 *   ./server.js
 *
 * A .bak copy of each file is saved before writing, so this is safe to
 * re-run and easy to undo (just rename the .bak file back).
 */

const fs = require("fs");
const path = require("path");

function resolveDefaultIndexPath() {
  const candidates = ["public/index.html", "index.html"];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const indexPath = process.argv[2] || resolveDefaultIndexPath();
const serverPath = process.argv[3] || "server.js";

// ---- replacement lists -----------------------------------------------
// Each entry: [ exact text to find, replacement text ]
// Applied with split/join so every occurrence is replaced.

const indexReplacements = [
  // lang attribute
  ['<html lang="fil">', '<html lang="en">'],

  // Month / category data
  [
    'var MONTHS_FIL = ["Enero","Pebrero","Marso","Abril","Mayo","Hunyo","Hulyo","Agosto","Setyembre","Oktubre","Nobyembre","Disyembre"];',
    'var MONTHS_FIL = ["January","February","March","April","May","June","July","August","September","October","November","December"];',
  ],
  [
    'var INCOME_CATEGORIES = ["Suweldo","Negosyo","Padala","Iba pang Kita"];',
    'var INCOME_CATEGORIES = ["Salary","Business","Remittance","Other Income"];',
  ],
  [
    'var EXPENSE_CATEGORIES = ["Pagkain","Bahay/Renta","Kuryente","Tubig","Load/Internet","Pamasahe","Ipon","Utang","Edukasyon","Kalusugan","Libangan","Iba pa"];',
    'var EXPENSE_CATEGORIES = ["Food","Rent/Housing","Electricity","Water","Load/Internet","Transportation","Savings","Debt","Education","Health","Entertainment","Other"];',
  ],

  // --- bug fix + clearer errors: apiCall() ---
  [
    'async function apiCall(path, opts) {\n    var res = await fetch(API + path, Object.assign({\n      headers: { "Content-Type": "application/json" }\n    }, opts || {}));\n    var body = null;\n    try { body = await res.json(); } catch (e) {}\n    if (!res.ok) {\n      var msg = (body && body.error) || ("HTTP " + res.status);\n      throw new Error(msg);\n    }\n    return body;\n  }',
    'async function apiCall(path, opts) {\n    var res;\n    try {\n      res = await fetch(API + path, Object.assign({\n        headers: { "Content-Type": "application/json" }\n      }, opts || {}));\n    } catch (e) {\n      throw new Error("network_error");\n    }\n    var body = null;\n    try { body = await res.json(); } catch (e) {}\n    if (!res.ok) {\n      var msg = (body && body.error) || (!body ? "server_unreachable" : ("HTTP " + res.status));\n      throw new Error(msg);\n    }\n    return body;\n  }',
  ],

  // handleCreate: friendlier message + unreachable-server detection
  [
    'authError = "Nagka-problema sa paggawa. Subukan ulit.";',
    'authError = (e.message === "server_unreachable" || e.message === "network_error")\n        ? "Can\'t reach the server. Make sure the app\'s backend is running (npm start), then reload the page."\n        : "Something went wrong creating the household. Please try again.";',
  ],
  ['authError = "Pangalanan ang inyong sambahayan.";', 'authError = "Please name your household.";'],
  ['authError = "Ilagay ang inyong pangalan.";', 'authError = "Please enter your name.";'],
  ['showToast("Nagawa ang sambahayan!");', 'showToast("Household created!");'],

  // handleJoin: fix the "not_found" mismatch + unreachable-server detection
  ['authError = "Ilagay ang code ng sambahayan.";', 'authError = "Please enter the household code.";'],
  ['showToast("Sumali sa " + body.household.name + "!");', 'showToast("Joined " + body.household.name + "!");'],
  [
    'authError = e.message === "not_found"\n        ? \'Walang sambahayang natagpuan sa code na "\' + esc(code) + \'".\'\n        : "Nagka-problema sa pagsali. Subukan ulit.";',
    'authError = e.message === "not_found"\n        ? \'No household found with that code "\' + esc(code) + \'".\'\n        : (e.message === "server_unreachable" || e.message === "network_error")\n          ? "Can\'t reach the server. Make sure the app\'s backend is running (npm start), then reload the page."\n          : "Something went wrong joining. Please try again.";',
  ],

  // entry / budget messages
  ['showToast("Ilagay ang wastong halaga.");', 'showToast("Please enter a valid amount.");'],
  [
    'showToast(entryType === "income" ? "Naidagdag ang kita." : "Naidagdag ang gasto.");',
    'showToast(entryType === "income" ? "Income added." : "Expense added.");',
  ],
  ['showToast("Hindi na-save — subukan ulit.");', 'showToast("Couldn\'t save — please try again.");'],
  ['if (!window.confirm("Tanggalin ang talang ito?")) return;', 'if (!window.confirm("Delete this entry?")) return;'],
  ['showToast("Tinanggal ang tala.");', 'showToast("Entry deleted.");'],
  ['showToast("Hindi na-tanggal — subukan ulit.");', 'showToast("Couldn\'t delete — please try again.");'],
  ['showToast("Pumili ng kategorya.");', 'showToast("Please select a category.");'],
  [
    'showToast("Na-set ang budget para sa " + category + ".");',
    'showToast("Budget set for " + category + ".");',
  ],
  ['showToast("Hindi na-save ang budget — subukan ulit.");', 'showToast("Couldn\'t save the budget — please try again.");'],
  ['showToast("Tinanggal ang budget.");', 'showToast("Budget removed.");'],

  // loading / error screens
  ['esc(msg || "Naglo-load...")', 'esc(msg || "Loading...")'],
  [
    'Kailangang naka-sign in sa Claude ang bawat gagamit ng app na ito para makita ang shared na datos ng sambahayan. Pakisuri ang inyong pag-sign in at subukang i-reload ang pahina.',
    "Every user of this app needs to be signed in to see the household's shared data. Please check your sign-in and try reloading the page.",
  ],
  ['Hindi mahanap ang sambahayan', 'Household not found'],
  ['Maaaring natanggal na ang sambahayang ito.', 'This household may have been deleted.'],
  ['Bumalik sa setup', 'Back to setup'],

  // dashboard
  [' \\u00B7 Kumusta, ', ' \\u00B7 Hi, '],
  ['>Umalis</button>', '>Log out</button>'],
  ['aria-label="Nakaraang buwan"', 'aria-label="Previous month"'],
  ['aria-label="Susunod na buwan"', 'aria-label="Next month"'],
  ['>Natitirang pondo</div>', '>Remaining balance</div>'],
  ['ledgerColumnHTML("Kita", "var(--income)"', 'ledgerColumnHTML("Income", "var(--income)"'],
  ['ledgerColumnHTML("Gastos", "var(--expense)"', 'ledgerColumnHTML("Expenses", "var(--expense)"'],
  ['>Paghahati-hati ng gastos</div>', '>Expense breakdown</div>'],
  [
    '<div class="section-label">Ambag ng bawat miyembro</div><div class="overflow-x"><table><thead><tr><th>Miyembro</th><th style="text-align:right">Kita</th><th style="text-align:right">Gastos</th></tr></thead><tbody>',
    '<div class="section-label">Each member\'s contribution</div><div class="overflow-x"><table><thead><tr><th>Member</th><th style="text-align:right">Income</th><th style="text-align:right">Expenses</th></tr></thead><tbody>',
  ],
  ['<div class="section-label">Idagdag na tala</div>', '<div class="section-label">Add entry</div>'],
  ['/> Gasto</label>', '/> Expense</label>'],
  ['/> Kita</label>', '/> Income</label>'],
  ['<label class="field">Kategorya<select class="input" id="f-category">', '<label class="field">Category<select class="input" id="f-category">'],
  [
    '<label class="field">Halaga (\\u20B1)<input class="input" type="number" min="0" step="0.01" id="f-amount" placeholder="0.00" /></label>',
    '<label class="field">Amount (\\u20B1)<input class="input" type="number" min="0" step="0.01" id="f-amount" placeholder="0.00" /></label>',
  ],
  ['Natitirang badyet sa ', 'Remaining budget for '],
  [
    '<label class="field">Tala (opsyonal)<input class="input" id="f-note" placeholder="Hal. Grocery sa Puregold" /></label>',
    '<label class="field">Note (optional)<input class="input" id="f-note" placeholder="e.g. Groceries at the store" /></label>',
  ],
  ['<label class="field">Petsa<input class="input" type="date"', '<label class="field">Date<input class="input" type="date"'],
  ['>+ Idagdag</button>', '>+ Add</button>'],

  // budgets section
  ['<div class="section-label">Mga Budget \\u2014 ', '<div class="section-label">Budgets \\u2014 '],
  ['Wala pang na-set na budget ngayong buwan.', 'No budget set for this month yet.'],
  ['<label class="field">Kategorya<select class="input" id="f-budget-category">', '<label class="field">Category<select class="input" id="f-budget-category">'],
  ['>I-set ang budget</button>', '>Set budget</button>'],
  ['title="Tanggalin ang budget" aria-label="Tanggalin ang budget"', 'title="Remove budget" aria-label="Remove budget"'],
  ['"Sobra ng " + peso(Math.abs(remaining)) : "Natitira: " + peso(remaining)', '"Over by " + peso(Math.abs(remaining)) : "Remaining: " + peso(remaining)'],

  // entry rows
  ['title="Tanggalin" aria-label="Tanggalin ang tala"', 'title="Delete" aria-label="Delete entry"'],
  ['>Walang tala pa.</div>', '>No entries yet.</div>'],

  // auth screen
  ['Ang libreta ng pamilya para sa kita at gastos.', 'The family notebook for income and expenses.'],
  ['id="tab-create">Gumawa ng sambahayan</button>', 'id="tab-create">Create a household</button>'],
  ['id="tab-join">Sumali sa sambahayan</button>', 'id="tab-join">Join a household</button>'],
  [
    '<label class="field">Inyong pangalan<input class="input" id="f-display" placeholder="Hal. Nanay Rosa" /></label>',
    '<label class="field">Your name<input class="input" id="f-display" placeholder="e.g. Mom Rosa" /></label>',
  ],
  [
    '<label class="field">Pangalan ng sambahayan<input class="input" id="f-household" placeholder="Hal. Pamilya Santos" /></label>',
    '<label class="field">Household name<input class="input" id="f-household" placeholder="e.g. The Santos Family" /></label>',
  ],
  ['placeholder="Hal. SANT-482"', 'placeholder="e.g. SANT-482"'],
  [
    '(busy ? "Ginagawa..." : (createActive ? "Gumawa ng sambahayan" : "Sumali"))',
    '(busy ? "Creating..." : (createActive ? "Create household" : "Join"))',
  ],
  [
    'Ang link na ito ay para lamang sa inyong pamilya. Sinumang may hawak ng link ay makakakita at makakadagdag ng tala sa sambahayang ito.',
    'This link is for your family only. Anyone who has the link can view and add entries to this household.',
  ],
];

const serverReplacements = [
  ['error: "Kailangan ang pangalan ng sambahayan."', 'error: "Household name is required."'],
  ['error: "Kailangan ang inyong pangalan."', 'error: "Your name is required."'],
  // Fix: make the join-route 404 use the same "not_found" key the GET route
  // uses, so the frontend's specific "no household found with that code"
  // message actually shows instead of a generic fallback error.
  ['error: "Walang sambahayang natagpuan sa code na iyan."', 'error: "not_found"'],
];

// ---- apply -------------------------------------------------------------

function applyReplacements(filePath, replacements) {
  if (!fs.existsSync(filePath)) {
    console.log(`[skip] ${filePath} not found.`);
    return;
  }
  const original = fs.readFileSync(filePath, "utf8");
  let text = original;
  let applied = 0;
  let missing = 0;

  replacements.forEach(([from, to]) => {
    if (text.indexOf(from) !== -1) {
      text = text.split(from).join(to);
      applied++;
    } else {
      missing++;
      console.log(`  (already patched or not found, skipping) ${JSON.stringify(from.slice(0, 60))}...`);
    }
  });

  if (text === original) {
    console.log(`[no changes] ${filePath} — nothing to patch (already up to date?).`);
    return;
  }

  const backupPath = filePath + ".bak";
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, original, "utf8");
    console.log(`[backup] saved original to ${backupPath}`);
  }

  fs.writeFileSync(filePath, text, "utf8");
  console.log(`[patched] ${filePath} — ${applied} replacement(s) applied, ${missing} skipped.`);
}

console.log("Patching Alkansya...\n");
console.log(`Frontend: ${indexPath}`);
applyReplacements(indexPath, indexReplacements);
console.log(`\nBackend: ${serverPath}`);
applyReplacements(serverPath, serverReplacements);
console.log("\nDone. Restart your server (npm start) and reload the page.");