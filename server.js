const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "households.json");

// ---------------------------------------------------------------------------
// Storage layer. Two implementations behind the same small interface,
// selected once at boot depending on whether MONGODB_URI is set. Everything
// below this block (the routes) is unaware of which backend is active.
//
// Render's free web services wipe the local filesystem on every restart,
// redeploy, or spin-down - that's why households were disappearing. Mongo
// Atlas lives outside that filesystem, so data survives restarts.
// ---------------------------------------------------------------------------

let store; // resolved to one of the two implementations below

function makeFileStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}), "utf8");

  function readAll() {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (e) {
      return {};
    }
  }
  function writeAll(all) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf8");
  }

  return {
    kind: "file",
    async init() {},
    async getHousehold(code) {
      const all = readAll();
      return all[code] || null;
    },
    async codeExists(code) {
      const all = readAll();
      return Boolean(all[code]);
    },
    async createHousehold(household) {
      const all = readAll();
      all[household.code] = household;
      writeAll(all);
    },
    async saveHousehold(household) {
      const all = readAll();
      all[household.code] = household;
      writeAll(all);
    },
  };
}

function makeMongoStore(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  let households; // collection handle, set in init()

  return {
    kind: "mongo",
    async init() {
      await client.connect();
      // Database name comes from MONGODB_DB if set, else this default.
      // (If your connection string already ends in /somedb, that name is
      // used automatically by the driver and MONGODB_DB is ignored.)
      const db = client.db(process.env.MONGODB_DB || "alkansya");
      households = db.collection("households");
      await households.createIndex({ code: 1 }, { unique: true });
    },
    async getHousehold(code) {
      return households.findOne({ code }, { projection: { _id: 0 } });
    },
    async codeExists(code) {
      const doc = await households.findOne({ code }, { projection: { _id: 1 } });
      return Boolean(doc);
    },
    async createHousehold(household) {
      await households.insertOne(household);
    },
    async saveHousehold(household) {
      await households.replaceOne({ code: household.code }, household, { upsert: true });
    },
  };
}

function uid() {
  return crypto.randomBytes(6).toString("hex");
}

async function genCode(name) {
  const base = (name || "PAM")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4)
    .padEnd(4, "X");
  let code;
  let tries = 0;
  do {
    const rand = Math.floor(100 + Math.random() * 900);
    code = base + "-" + rand;
    tries++;
  } while ((await store.codeExists(code)) && tries < 20);
  return code;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Create a new household. Body: { householdName, displayName }
app.post("/api/households", async (req, res) => {
  try {
    const { householdName, displayName } = req.body || {};
    if (!householdName || !householdName.trim()) {
      return res.status(400).json({ error: "Household name is required." });
    }
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ error: "Your name is required." });
    }
    const code = await genCode(householdName);
    const viewerId = uid();
    const household = {
      code,
      name: householdName.trim(),
      members: [{ id: viewerId, displayName: displayName.trim() }],
      entries: [],
      budgets: {},
    };
    await store.createHousehold(household);
    res.json({ code, viewerId, household });
  } catch (e) {
    console.error("POST /api/households failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// Join an existing household. Body: { displayName }
app.post("/api/households/:code/join", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { displayName } = req.body || {};
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ error: "Your name is required." });
    }
    const household = await store.getHousehold(code);
    if (!household) {
      return res.status(404).json({ error: "not_found" });
    }
    const viewerId = uid();
    household.members.push({ id: viewerId, displayName: displayName.trim() });
    await store.saveHousehold(household);
    res.json({ code, viewerId, household });
  } catch (e) {
    console.error("POST /api/households/:code/join failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// Fetch a household (used on load and by polling for live-ish updates)
app.get("/api/households/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const household = await store.getHousehold(code);
    if (!household) return res.status(404).json({ error: "not_found" });
    res.json({ household });
  } catch (e) {
    console.error("GET /api/households/:code failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// Partial update: body may include entries, budgets, and/or members
app.patch("/api/households/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const household = await store.getHousehold(code);
    if (!household) return res.status(404).json({ error: "not_found" });

    const { entries, budgets, members } = req.body || {};
    if (entries !== undefined) household.entries = entries;
    if (budgets !== undefined) household.budgets = budgets;
    if (members !== undefined) household.members = members;

    await store.saveHousehold(household);
    res.json({ household });
  } catch (e) {
    console.error("PATCH /api/households/:code failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

async function start() {
  store = MONGODB_URI ? makeMongoStore(MONGODB_URI) : makeFileStore();
  try {
    await store.init();
  } catch (e) {
    console.error("Storage init failed (" + store.kind + "):", e.message);
    if (store.kind === "mongo") {
      console.error("Falling back to the local JSON file for this run. Fix MONGODB_URI to persist data.");
      store = makeFileStore();
      await store.init();
    } else {
      throw e;
    }
  }
  app.listen(PORT, () => {
    console.log("Alkansya running on port " + PORT + " (storage: " + store.kind + ")");
  });
}

start();
