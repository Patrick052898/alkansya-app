#!/usr/bin/env node
/*
 * Alkansya patcher (index.html only):
 *   1) Your custom EXPENSE categories now show up in the "Set budget" category list.
 *   2) The Income column in the Categories section is removed (expense categories only).
 *      You can still add an income category from the "+ Add new category..." option
 *      in the Add entry form.
 *   3) New button in Budgets: "Copy budgets from <previous month>". It copies last
 *      month's budgets into this month, keeping any you already set this month.
 *      The button only appears when there is something to copy.
 *
 * Usage (from your project folder):
 *   node patch-budget.js
 *   node patch-budget.js path/to/index.html
 *
 * Makes a backup (index.html.bak-budget) first. Safe to run twice.
 */
const fs = require("fs");
const path = require("path");

const arg = process.argv[2];
const target = (arg ? [arg] : ["public/index.html", "index.html"]).find((p) => fs.existsSync(p));
if (!target) {
  console.error("Could not find index.html. Pass the path: node patch-budget.js path/to/index.html");
  process.exit(1);
}

const original = fs.readFileSync(target);
let src = original.toString("utf8");
const crlf = src.includes("\r\n");
if (crlf) src = src.replace(/\r\n/g, "\n");

if (src.includes("__budget_copy_v1__")) {
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

// 1) Budget category dropdown uses built-in + custom expense categories
replaceOnce(
  "budget dropdown categories",
  "EXPENSE_CATEGORIES.map(function (c) { return '<option value=\"' + esc(c) + '\">' + esc(c) + '</option>'; }).join(\"\") +",
  "categoriesFor(\"expense\").map(function (c) { return '<option value=\"' + esc(c) + '\">' + esc(c) + '</option>'; }).join(\"\") +"
);

// 2) Categories section: expense only
replaceOnce(
  "categories section layout",
  "'<div class=\"two-col\">' + colHTML(\"income\", \"Income\") + colHTML(\"expense\", \"Expense\") + '</div>' +",
  "'<div>' + colHTML(\"expense\", \"Expense\") + '</div>' +"
);

// 3a) copy-from-previous-month: figure out if there is anything to copy
replaceOnce(
  "budget section vars",
  "    var categories = Object.keys(monthBudgets);\n",
  `    var categories = Object.keys(monthBudgets);
    var prevM = activeMonthIdx - 1, prevY = activeYear;
    if (prevM < 0) { prevM = 11; prevY -= 1; }
    var prevBudgets = (household.budgets && household.budgets[monthKey(prevY, prevM)]) || {};
    var canCopy = Object.keys(prevBudgets).some(function (c) { return monthBudgets[c] === undefined; });
`
);

// 3b) the button
replaceOnce(
  "copy button",
  "(rows || '<div class=\"entry-empty\" style=\"margin-bottom:14px\">No budget set for this month yet.</div>') +\n",
  "(rows || '<div class=\"entry-empty\" style=\"margin-bottom:14px\">No budget set for this month yet.</div>') +\n" +
  "        (canCopy ? '<button type=\"button\" class=\"btn-ghost\" id=\"copy-budget\" style=\"margin-bottom:14px\">Copy budgets from ' + MONTHS_FIL[prevM] + '</button>' : '') +\n"
);

// 3c) the function
replaceOnce(
  "copy function",
  "  async function removeBudget(category) {\n",
  `  // __budget_copy_v1__
  async function copyPrevBudgets() {
    var pm = activeMonthIdx - 1, py = activeYear;
    if (pm < 0) { pm = 11; py -= 1; }
    var budgets = Object.assign({}, household.budgets || {});
    var prev = budgets[monthKey(py, pm)] || {};
    var mk = monthKey(activeYear, activeMonthIdx);
    var current = Object.assign({}, budgets[mk] || {});
    var added = 0;
    Object.keys(prev).forEach(function (cat) {
      if (current[cat] === undefined) { current[cat] = prev[cat]; added++; }
    });
    if (!added) { showToast("Nothing to copy."); return; }
    budgets[mk] = current;
    try {
      await patchHousehold({ budgets: budgets });
      render();
      showToast("Copied " + added + " budget" + (added === 1 ? "" : "s") + " from " + MONTHS_FIL[pm] + ".");
    } catch (e) {
      showToast("Couldn't copy the budgets — please try again.");
    }
  }

  async function removeBudget(category) {
`
);

// 3d) wire the button
replaceOnce(
  "copy button handler",
  '    var budgetForm = document.getElementById("budget-form");\n',
  `    var copyBtn = document.getElementById("copy-budget");
    if (copyBtn) copyBtn.onclick = copyPrevBudgets;

    var budgetForm = document.getElementById("budget-form");
`
);

fs.writeFileSync(target + ".bak-budget", original);
fs.writeFileSync(target, crlf ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("Patched " + path.resolve(target));
console.log("Backup saved as " + target + ".bak-budget");