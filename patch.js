#!/usr/bin/env node
/*
 * Alkansya ALL-IN-ONE patcher.
 *
 * Applies every fix/feature we built, in one go, to server.js and index.html:
 *   1. Add-entry form no longer resets while you type        (index.html)
 *   2. Remove member button (x) in the member table          (index.html)
 *   3. Joining with an existing name (any case) signs you back in
 *      instead of creating a duplicate                       (server.js + index.html)
 *   4. "Add category" saves properly                         (server.js)
 *   5. Budget: custom expense categories in "Set budget", Income category column
 *      removed, "Copy budgets from <previous month>" button  (index.html)
 *   6. Monthly comparison: chart of all months, this vs last month,
 *      NEW expense categories                                (index.html)
 *
 * Usage (from your project folder, next to server.js):
 *   node patch-all.js
 *   node patch-all.js path/to/server.js path/to/index.html
 *
 * - Steps that are already applied are skipped, so it is safe to run again.
 * - Nothing is written unless EVERY step can be applied (all-or-nothing).
 * - Backups are saved next to each file as *.bak-<date>-<time>.
 * - Then redeploy BOTH files.
 */
const fs = require("fs");
const path = require("path");

const serverPath = process.argv[2] || (fs.existsSync("server.js") ? "server.js" : null);
const htmlPath =
  process.argv[3] || ["public/index.html", "index.html"].find((p) => fs.existsSync(p));
if (!serverPath || !fs.existsSync(serverPath)) {
  console.error("Could not find server.js. Run this from your project folder, or pass the paths.");
  process.exit(1);
}
if (!htmlPath || !fs.existsSync(htmlPath)) {
  console.error("Could not find index.html (looked in public/index.html and index.html).");
  process.exit(1);
}

function load(file) {
  const raw = fs.readFileSync(file);
  let text = raw.toString("utf8");
  const crlf = text.includes("\r\n");
  if (crlf) text = text.replace(/\r\n/g, "\n");
  return { file, raw, text, crlf };
}

const files = { server: load(serverPath), html: load(htmlPath) };
let src = ""; // text of the file currently being patched
let currentFile = "";
let currentStep = "";

function replaceOnce(label, find, replacement) {
  const count = src.split(find).length - 1;
  if (count !== 1) {
    console.error(
      "FAILED in step '" + currentStep + "' (" + label + ", " + currentFile + "): expected 1 match, found " +
      count + ". Nothing was changed."
    );
    process.exit(1);
  }
  src = src.replace(find, () => replacement);
}

const steps = [
  {
    name: "1. Typing no longer resets",
    file: "html",
    done: () => src.includes("__typing_fix_v1__"),
    run: () => {
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
    },
  },
  {
    name: "2. Remove member button",
    file: "html",
    done: () => src.includes("__remove_member_v1__"),
    run: () => {
    // 1) The removeMember function
    replaceOnce(
      "add removeMember()",
      "  async function deleteEntry(id, ownerViewerId) {\n",
      `  // __remove_member_v1__
      async function removeMember(id, name) {
        if (!id || id === profile.viewerId) {
          showToast("You can't remove yourself. Use Log out instead.");
          return;
        }
        if (!window.confirm('Remove "' + name + '" from this household?')) return;
        var fields = {
          members: (household.members || []).filter(function (m) { return m.id !== id; })
        };
        var theirs = (household.entries || []).filter(function (en) { return en.viewerId === id; });
        if (theirs.length && window.confirm(
          name + " has " + theirs.length + " entries.\\n\\nOK = also delete their entries\\nCancel = keep their entries (totals stay the same)"
        )) {
          fields.entries = (household.entries || []).filter(function (en) { return en.viewerId !== id; });
        }
        try {
          await patchHousehold(fields);
          render();
          showToast("Member removed.");
        } catch (e) {
          showToast("Couldn't remove — please try again.");
        }
      }

      async function deleteEntry(id, ownerViewerId) {
    `
    );

    // 2) Keep each member's id in the breakdown
    replaceOnce(
      "member id (members)",
      "memberMap[m.id] = { displayName: m.displayName, income: 0, expense: 0 };",
      "memberMap[m.id] = { id: m.id, displayName: m.displayName, income: 0, expense: 0 };"
    );
    replaceOnce(
      "member id (entries)",
      "memberMap[en.viewerId] = { displayName: en.displayName, income: 0, expense: 0 };",
      "memberMap[en.viewerId] = { id: en.viewerId, displayName: en.displayName, income: 0, expense: 0 };"
    );

    // 3) Table header + remove button per row (never on your own row)
    replaceOnce(
      "table header",
      '<th style="text-align:right">Expenses</th></tr></thead>',
      '<th style="text-align:right">Expenses</th><th></th></tr></thead>'
    );
    replaceOnce(
      "table row button",
      "+ peso(m.expense) + '</td></tr>';",
      "+ peso(m.expense) + '</td><td style=\"text-align:right\">' + (m.id && m.id !== profile.viewerId ? '<button type=\"button\" class=\"btn-icon\" data-rmmember=\"' + esc(m.id) + '\" data-rmname=\"' + esc(m.displayName) + '\" title=\"Remove member\" aria-label=\"Remove member\">\\u2715</button>' : '') + '</td></tr>';"
    );

    // 4) Click handler
    replaceOnce(
      "click handler",
      '    var budgetForm = document.getElementById("budget-form");\n',
      `    Array.prototype.forEach.call(root.querySelectorAll("[data-rmmember]"), function (btn) {
          btn.onclick = function () {
            removeMember(btn.getAttribute("data-rmmember"), btn.getAttribute("data-rmname"));
          };
        });

        var budgetForm = document.getElementById("budget-form");
    `
    );

    // 5) If YOU get removed by someone else, send this device back to setup
    replaceOnce(
      "removed-user check",
      "      if (silent && isEditingForm()) return;\n",
      `      if (profile && profile.viewerId && !(household.members || []).some(function (m) { return m.id === profile.viewerId; })) {
            handleLogout();
            showToast("You were removed from this household.");
            return;
          }
          if (silent && isEditingForm()) return;
    `
    );
    },
  },
  {
    name: "3a. Re-join with same name (server.js)",
    file: "server",
    done: () => src.includes("__rejoin_fix_v1__"),
    run: () => {
      replaceOnce(
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
    },
  },
  {
    name: "3b. Re-join with same name (index.html)",
    file: "html",
    done: () => src.includes("body.rejoined"),
    run: () => {
      replaceOnce(
        "client saveProfile",
        "saveProfile({ householdCode: code, viewerId: body.viewerId, displayName: displayName.trim() });",
        "saveProfile({ householdCode: code, viewerId: body.viewerId, displayName: body.displayName || displayName.trim() });"
      );
      replaceOnce(
        "client toast",
        'showToast("Joined " + body.household.name + "!");',
        'showToast((body.rejoined ? "Welcome back to " : "Joined ") + body.household.name + "!");'
      );
    },
  },
  {
    name: "4. Add category saves (server.js)",
    file: "server",
    done: () => src.includes("customCategories"),
    run: () => {
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
    },
  },
  {
    name: "5. Budget: categories, copy last month",
    file: "html",
    done: () => src.includes("__budget_copy_v1__"),
    run: () => {
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
    },
  },
  {
    name: "6. Monthly comparison",
    file: "html",
    done: () => src.includes("__monthly_compare_v1__"),
    run: () => {
    const FUNCS = String.raw`  // __monthly_compare_v1__
      function monthlyTotals() {
        var map = {};
        (household.entries || []).forEach(function (en) {
          var k = String(en.date || "").slice(0, 7);
          if (!/^\d{4}-\d{2}$/.test(k)) return;
          var m = map[k] || (map[k] = { income: 0, expense: 0, cats: {} });
          var amt = Number(en.amount) || 0;
          if (en.type === "income") m.income += amt;
          else { m.expense += amt; m.cats[en.category] = (m.cats[en.category] || 0) + amt; }
        });
        return map;
      }

      function compactNum(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
        return String(Math.round(n));
      }

      function allMonthsChartSVG(totals, keys, activeKey) {
        var n = keys.length;
        var colW = 64, left = 8, top = 16, plotH = 150, bottom = 36, bw = 20;
        var w = left * 2 + n * colW, h = top + plotH + bottom;
        var maxVal = 1;
        keys.forEach(function (k) {
          var t = totals[k];
          if (t) maxVal = Math.max(maxVal, t.income, t.expense);
        });
        var parts = keys.map(function (k, i) {
          var t = totals[k] || { income: 0, expense: 0 };
          var x0 = left + i * colW;
          var iH = (t.income / maxVal) * plotH, eH = (t.expense / maxVal) * plotH;
          var ix = x0 + 10, ex = x0 + 10 + bw + 4;
          var y = parseInt(k.slice(0, 4), 10), mi = parseInt(k.slice(5, 7), 10) - 1;
          var s = "";
          if (k === activeKey) s += '<rect x="' + x0 + '" y="' + (top - 8) + '" width="' + colW + '" height="' + (plotH + bottom) + '" fill="var(--rule)" opacity="0.28" rx="4" />';
          if (t.income > 0) {
            s += '<rect x="' + ix + '" y="' + (top + plotH - Math.max(2, iH)) + '" width="' + bw + '" height="' + Math.max(2, iH) + '" rx="2" fill="var(--income)" />';
            s += '<text x="' + (ix + bw / 2) + '" y="' + (top + plotH - Math.max(2, iH) - 3) + '" text-anchor="middle" font-size="9.5" fill="var(--ink-soft)">' + compactNum(t.income) + '</text>';
          }
          if (t.expense > 0) {
            s += '<rect x="' + ex + '" y="' + (top + plotH - Math.max(2, eH)) + '" width="' + bw + '" height="' + Math.max(2, eH) + '" rx="2" fill="var(--expense)" />';
            s += '<text x="' + (ex + bw / 2) + '" y="' + (top + plotH - Math.max(2, eH) - 3) + '" text-anchor="middle" font-size="9.5" fill="var(--ink-soft)">' + compactNum(t.expense) + '</text>';
          }
          s += '<text x="' + (x0 + colW / 2) + '" y="' + (top + plotH + 15) + '" text-anchor="middle" font-size="11.5" fill="var(--ink)">' + esc(MONTHS_FIL[mi].slice(0, 3)) + '</text>';
          s += '<text x="' + (x0 + colW / 2) + '" y="' + (top + plotH + 28) + '" text-anchor="middle" font-size="10" fill="var(--ink-soft)">' + y + '</text>';
          s += '<rect x="' + x0 + '" y="' + (top - 8) + '" width="' + colW + '" height="' + (plotH + bottom) + '" fill="transparent" style="cursor:pointer" data-gomonth="' + k + '"><title>' + esc(MONTHS_FIL[mi]) + ' ' + y + '</title></rect>';
          return s;
        }).join("");
        var base = '<line x1="' + left + '" y1="' + (top + plotH) + '" x2="' + (w - left) + '" y2="' + (top + plotH) + '" stroke="var(--rule)" />';
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" style="display:block" xmlns="http://www.w3.org/2000/svg">' + base + parts + '</svg>';
      }

      function changeCell(diff, goodWhenUp) {
        if (Math.abs(diff) < 0.005) return '<span style="color:var(--ink-soft)">\u2014</span>';
        var up = diff > 0;
        var good = goodWhenUp ? up : !up;
        return '<span style="color:' + (good ? "var(--income)" : "var(--expense)") + '">' + (up ? "\u25B2 " : "\u25BC ") + peso(Math.abs(diff)) + '</span>';
      }

      function comparisonSectionHTML() {
        var totals = monthlyTotals();
        var activeKey = monthKey(activeYear, activeMonthIdx);
        var pm = activeMonthIdx - 1, py = activeYear;
        if (pm < 0) { pm = 11; py -= 1; }
        var prevKey = monthKey(py, pm);

        var existing = Object.keys(totals);
        if (!existing.length) {
          return '<div style="margin-bottom:28px"><div class="section-label">Monthly comparison</div><div class="entry-empty">Add some entries and the month-by-month chart and comparison will show up here.</div></div>';
        }
        var all = existing.concat([activeKey]).sort();
        var first = all[0], last = all[all.length - 1];
        var keys = [];
        var cy = parseInt(first.slice(0, 4), 10), cm = parseInt(first.slice(5, 7), 10) - 1;
        var guard = 0;
        while (guard++ < 600) {
          var k = monthKey(cy, cm);
          keys.push(k);
          if (k === last) break;
          cm += 1; if (cm > 11) { cm = 0; cy += 1; }
        }

        var cur = totals[activeKey] || { income: 0, expense: 0, cats: {} };
        var prev = totals[prevKey] || { income: 0, expense: 0, cats: {} };
        var hasPrev = !!totals[prevKey];

        var summary = [
          ["Income", prev.income, cur.income, true],
          ["Expenses", prev.expense, cur.expense, false],
          ["Balance", prev.income - prev.expense, cur.income - cur.expense, true]
        ].map(function (r) {
          return '<tr><td>' + r[0] + '</td><td class="num" style="text-align:right">' + peso(r[1]) + '</td><td class="num" style="text-align:right">' + peso(r[2]) + '</td><td class="num" style="text-align:right">' + changeCell(r[2] - r[1], r[3]) + '</td></tr>';
        }).join("");

        var catNames = {};
        Object.keys(cur.cats).forEach(function (c) { catNames[c] = true; });
        Object.keys(prev.cats).forEach(function (c) { catNames[c] = true; });
        var catRows = Object.keys(catNames).map(function (c) {
          return { category: c, cur: cur.cats[c] || 0, prev: prev.cats[c] || 0 };
        }).sort(function (a, b) { return (b.cur - a.cur) || (b.prev - a.prev); });

        var newOnes = catRows.filter(function (r) { return r.cur > 0 && r.prev === 0; });
        var showNew = prev.expense > 0;

        var catTable = catRows.length
          ? '<div class="overflow-x"><table><thead><tr><th>Expense category</th><th style="text-align:right">' + esc(MONTHS_FIL[pm].slice(0, 3)) + '</th><th style="text-align:right">' + esc(MONTHS_FIL[activeMonthIdx].slice(0, 3)) + '</th><th style="text-align:right">Change</th></tr></thead><tbody>' +
            catRows.map(function (r) {
              var isNew = showNew && r.cur > 0 && r.prev === 0;
              var tag = isNew ? ' <span style="font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:8px;padding:0 6px;margin-left:4px">NEW</span>' : "";
              return '<tr><td>' + esc(r.category) + tag + '</td><td class="num" style="text-align:right">' + peso(r.prev) + '</td><td class="num" style="text-align:right">' + peso(r.cur) + '</td><td class="num" style="text-align:right">' + changeCell(r.cur - r.prev, false) + '</td></tr>';
            }).join("") + '</tbody></table></div>'
          : '<div class="entry-empty">No expenses in either month.</div>';

        var newLine = (showNew && newOnes.length)
          ? '<div style="font-size:13px;margin:0 0 12px"><strong>New expenses this month:</strong> ' + newOnes.map(function (r) { return esc(r.category) + ' (' + peso(r.cur) + ')'; }).join(", ") + '</div>'
          : (showNew ? '<div style="font-size:13px;color:var(--ink-soft);margin:0 0 12px">No new expense categories this month.</div>' : "");

        return (
          '<div style="margin-bottom:28px">' +
            '<div class="section-label">Monthly comparison</div>' +
            '<div style="display:flex;gap:14px;font-size:12px;color:var(--ink-soft);margin-bottom:6px">' +
              '<span><span style="display:inline-block;width:10px;height:10px;background:var(--income);border-radius:2px;margin-right:5px"></span>Income</span>' +
              '<span><span style="display:inline-block;width:10px;height:10px;background:var(--expense);border-radius:2px;margin-right:5px"></span>Expenses</span>' +
              '<span style="margin-left:auto">Tap a month to open it</span>' +
            '</div>' +
            '<div class="overflow-x" style="margin-bottom:18px">' + allMonthsChartSVG(totals, keys, activeKey) + '</div>' +
            '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + esc(MONTHS_FIL[activeMonthIdx]) + ' ' + activeYear + ' vs ' + esc(MONTHS_FIL[pm]) + ' ' + py + (hasPrev ? "" : ' <span style="font-weight:400;color:var(--ink-soft)">(no entries last month)</span>') + '</div>' +
            '<div class="overflow-x" style="margin-bottom:16px"><table><thead><tr><th></th><th style="text-align:right">' + esc(MONTHS_FIL[pm].slice(0, 3)) + '</th><th style="text-align:right">' + esc(MONTHS_FIL[activeMonthIdx].slice(0, 3)) + '</th><th style="text-align:right">Change</th></tr></thead><tbody>' + summary + '</tbody></table></div>' +
            newLine +
            catTable +
          '</div>'
        );
      }

    `;

    // 1) functions (placed right before categoriesSectionHTML)
    replaceOnce(
      "insert functions",
      "  function categoriesSectionHTML() {\n",
      FUNCS + "  function categoriesSectionHTML() {\n"
    );

    // 2) render the section above Categories
    replaceOnce(
      "render section",
      "categoriesSectionHTML() +",
      "comparisonSectionHTML() +\n\n        categoriesSectionHTML() +"
    );

    // 3) tap a month in the chart to open it
    replaceOnce(
      "month tap handler",
      '    var budgetForm = document.getElementById("budget-form");\n',
      `    Array.prototype.forEach.call(root.querySelectorAll("[data-gomonth]"), function (el) {
          el.onclick = function () {
            var k = el.getAttribute("data-gomonth");
            activeYear = parseInt(k.slice(0, 4), 10);
            activeMonthIdx = parseInt(k.slice(5, 7), 10) - 1;
            render();
            window.scrollTo(0, 0);
          };
        });

        var budgetForm = document.getElementById("budget-form");
    `
    );
    },
  },
];

// ---- run all steps in memory ----
const changed = { server: false, html: false };
const report = [];
for (const step of steps) {
  currentStep = step.name;
  currentFile = files[step.file].file;
  src = files[step.file].text;
  if (step.done()) {
    report.push("  skipped (already applied)  " + step.name);
    continue;
  }
  step.run();
  files[step.file].text = src;
  changed[step.file] = true;
  report.push("  APPLIED                    " + step.name);
}

console.log(report.join("\n"));

// ---- write (only now that everything succeeded) ----
const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
for (const key of ["server", "html"]) {
  const f = files[key];
  if (!changed[key]) continue;
  fs.writeFileSync(f.file + ".bak-" + stamp, f.raw);
  fs.writeFileSync(f.file, f.crlf ? f.text.replace(/\n/g, "\r\n") : f.text, "utf8");
  console.log("\nPatched " + path.resolve(f.file) + "  (backup: " + f.file + ".bak-" + stamp + ")");
}
if (!changed.server && !changed.html) console.log("\nNothing to do - everything is already patched.");
else console.log("\nDone. Redeploy server.js and index.html, then hard-refresh the page (Ctrl+Shift+R).");