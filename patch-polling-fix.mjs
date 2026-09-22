// patch-polling-fix.mjs
// Run with: node patch-polling-fix.mjs
//
// Fixes the "category snaps back to Food" bug: the background poll
// (every 4s) was doing a full re-render even while you were mid-select
// in the Add-entry form, yanking the dropdown out from under you.
//
// This patches an index.html that already has the categories/cut-off
// update applied. It's idempotent — safe to run more than once, and it
// will tell you clearly if it can't find what it's looking for instead
// of silently doing nothing.

import fs from "fs";
import path from "path";

// Adjust this if your index.html isn't at the project root / public/.
const candidates = ["index.html", "public/index.html"];
const targetPath = candidates.map((p) => path.join(process.cwd(), p)).find(fs.existsSync);

if (!targetPath) {
  console.error("Couldn't find index.html or public/index.html in " + process.cwd());
  console.error("Run this script from your project root, or edit the 'candidates' list at the top of the script.");
  process.exit(1);
}

console.log("Patching:", targetPath);
let src = fs.readFileSync(targetPath, "utf8");

if (src.includes("isEditingForm")) {
  console.log("Already patched (found isEditingForm). Nothing to do.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Patch 1: loadHouseholdOnce — skip the disruptive re-render on a silent
// background poll while the user is actively using the form.
// ---------------------------------------------------------------------------
const oldLoad =
`  async function loadHouseholdOnce(code, silent) {
    try {
      var body = await apiCall("/households/" + encodeURIComponent(code));
      household = body.household;
      household.__code = code;
      view = "dashboard";
      render();
    } catch (e) {
      if (!silent) {
        household = null;
        view = "missing-household";
        render();
      }
    }
  }`;

const newLoad =
`  function isEditingForm() {
    var el = document.activeElement;
    return !!(el && el.closest && el.closest("#entry-form, #budget-form"));
  }

  async function loadHouseholdOnce(code, silent) {
    try {
      var body = await apiCall("/households/" + encodeURIComponent(code));
      household = body.household;
      household.__code = code;
      view = "dashboard";
      // A silent background poll can land mid-interaction (e.g. while a
      // <select> dropdown is open) and a full re-render would yank the
      // form out from under the user, making their in-progress pick look
      // like it "reverted". So while they're actively in the form, just
      // update the data quietly and skip the render — the next natural
      // render (on submit, or the next poll after they've moved on) will
      // pick up the fresh data.
      if (silent && isEditingForm()) return;
      render();
    } catch (e) {
      if (!silent) {
        household = null;
        view = "missing-household";
        render();
      }
    }
  }`;

if (!src.includes(oldLoad)) {
  console.error("Couldn't find the expected loadHouseholdOnce function to patch.");
  console.error("Your index.html may differ from the version this patch expects.");
  process.exit(1);
}
src = src.replace(oldLoad, newLoad);
console.log("  Patched loadHouseholdOnce (added isEditingForm guard).");

// ---------------------------------------------------------------------------
// Patch 2: re-render as soon as the user leaves the form, so data queued
// up during silent polls gets picked up.
// ---------------------------------------------------------------------------
const oldWiring =
`    Array.prototype.forEach.call(root.querySelectorAll("[data-addcat-form]"), function (form) {
      form.onsubmit = function (e) {
        e.preventDefault();
        var type = form.getAttribute("data-addcat-form");
        var input = form.querySelector("[data-addcat-input]");
        addCategory(type, input.value).then(function (ok) {
          if (ok) render();
        });
      };
    });`;

const newWiring = oldWiring +
`

    Array.prototype.forEach.call(root.querySelectorAll("#entry-form, #budget-form"), function (formEl) {
      formEl.addEventListener("focusout", function () {
        setTimeout(function () { if (!isEditingForm()) render(); }, 0);
      });
    });`;

if (!src.includes(oldWiring)) {
  console.warn("  WARNING: couldn't find the [data-addcat-form] wiring block — skipping the focusout patch.");
  console.warn("  (The main fix from Patch 1 is already applied, which covers the reported bug.)");
} else {
  src = src.replace(oldWiring, newWiring);
  console.log("  Patched form wiring (added focusout re-render).");
}

fs.writeFileSync(targetPath, src, "utf8");
console.log("\nDone. Commit and push, then redeploy.");
