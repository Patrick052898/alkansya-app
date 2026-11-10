#!/usr/bin/env node
/*
 * Alkansya patcher: adds a "remove member" (✕) button to the
 * "Each member's contribution" table.
 *
 * Usage (from your project folder):
 *   node patch-remove-member.js                -> finds public/index.html or index.html
 *   node patch-remove-member.js path/to/index.html
 *
 * Makes a backup (index.html.bak-member) first. Safe to run twice.
 * Works whether or not you already ran patch-index.js.
 */
const fs = require("fs");
const path = require("path");

const arg = process.argv[2];
const target = (arg ? [arg] : ["public/index.html", "index.html"]).find((p) => fs.existsSync(p));
if (!target) {
  console.error("Could not find index.html. Pass the path: node patch-remove-member.js path/to/index.html");
  process.exit(1);
}

let src = fs.readFileSync(target, "utf8");
const hadCRLF = src.includes("\r\n");
if (hadCRLF) src = src.replace(/\r\n/g, "\n");

if (src.includes("__remove_member_v1__")) {
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

fs.writeFileSync(target + ".bak-member", fs.readFileSync(target));
if (hadCRLF) src = src.replace(/\n/g, "\r\n");
fs.writeFileSync(target, src, "utf8");
console.log("Patched " + path.resolve(target));
console.log("Backup saved as " + target + ".bak-member");