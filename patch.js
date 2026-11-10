#!/usr/bin/env node
/*
 * Alkansya patcher (index.html only): adds a "Monthly comparison" section.
 *
 *   - Chart of ALL months (income vs expenses). Tap a month to jump to it.
 *   - This month vs previous month: income, expenses, balance, with the change.
 *   - Per-category table showing what changed, with a NEW tag on expense
 *     categories that had no spending last month.
 *   - Always uses the whole month (ignores the CO1/CO2 filter).
 *
 * Usage (from your project folder):
 *   node patch-compare.js
 *   node patch-compare.js path/to/index.html
 *
 * Makes a backup (index.html.bak-compare) first. Safe to run twice.
 */
const fs = require("fs");
const path = require("path");

const arg = process.argv[2];
const target = (arg ? [arg] : ["public/index.html", "index.html"]).find((p) => fs.existsSync(p));
if (!target) {
  console.error("Could not find index.html. Pass the path: node patch-compare.js path/to/index.html");
  process.exit(1);
}

const original = fs.readFileSync(target);
let src = original.toString("utf8");
const crlf = src.includes("\r\n");
if (crlf) src = src.replace(/\r\n/g, "\n");

if (src.includes("__monthly_compare_v1__")) {
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
    if (!existing.length) return "";
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

fs.writeFileSync(target + ".bak-compare", original);
fs.writeFileSync(target, crlf ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("Patched " + path.resolve(target));
console.log("Backup saved as " + target + ".bak-compare");