import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "15mb" })); // charts as base64 can be a few MB

// ---------------------------------------------------------------------------
// MongoDB
// ---------------------------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/traderapp";

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

const tradeSchema = new mongoose.Schema(
  {
    instrument: String,
    label: String,
    direction: { type: String, enum: ["buy", "sell"] },
    timing: { type: String, enum: ["NOW", "WAIT"] },
    timeframe: String, // e.g. "15m", "1h" — the candle timeframe selected at analysis time
    approxPrice: String,
    tp1: String,
    tp2: String,
    winProbability: Number,
    rationale: String,
    invalidation: String,
    status: { type: String, enum: ["open", "win", "loss"], default: "open" },
    resolvedAt: Date,
  },
  { timestamps: true }
);

const Trade = mongoose.model("Trade", tradeSchema);

// ---------------------------------------------------------------------------
// Chart analysis (unchanged)
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a technical chart-reading assistant. You will be shown a screenshot of a trading chart (candlesticks, possibly with existing lines/labels from a trading app UI).

Identify exactly 3 distinct, plausible entry points a trader might consider based on visible technical structure (support/resistance, trendlines, breakout/retest zones, recent swing highs/lows, consolidation ranges, etc). Vary them where sensible (not all three need to be the same direction).

For each entry, also decide "timing": "NOW" if the entry price is at or very close to the current market price (so it's actionable immediately), or "WAIT" if price needs to move to that level first (a level to set an alert/pending order at, not act on yet).

For each entry also give two take-profit levels ("tp1", "tp2") in the same direction as the trade, spaced at reasonable technical levels (e.g. next minor level for tp1, next major level for tp2), as plain price strings matching the axis format.

For each entry, also give a "win_probability": an integer 0-100 representing YOUR SUBJECTIVE CONFIDENCE that price reaches tp1 before hitting the invalidation level, based purely on the technical confluence visible in this single screenshot (number of confirming signals, cleanliness of the level, proximity to major structure, etc). This is a rough qualitative read, not a statistical or backtested win rate — do not imply precision beyond that. Avoid clustering all three around the same number; differentiate based on setup quality.

For each entry point estimate "y_percent": the vertical position of that price level within the chart's PLOTTING AREA ONLY (the candlestick area, not including the top toolbar or bottom axis labels), where 0 = top of the plotting area and 100 = bottom of the plotting area. Be as accurate as you can by visually comparing to the gridlines/price labels shown.

Also produce exactly 3 "execution scenarios" describing how price could behave AFTER entry and what a trader might do in each case — a conservative/risk-reduction case, a continuation case, and a downside-invalidation case. Base the specific price levels on the entries you identified and the visible chart structure (nearby swing points, round numbers, the current price).

Respond with ONLY raw JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "instrument": "string, e.g. ticker/symbol visible on chart, or best guess",
  "chart_summary": "2-3 sentence plain-language read of current structure/trend",
  "entries": [
    {
      "label": "short name, e.g. 'Range Support Bounce'",
      "direction": "buy" or "sell",
      "timing": "NOW" or "WAIT",
      "approx_price": "string, e.g. '29,450' — best estimate reading the axis",
      "tp1": "string, first take-profit price",
      "tp2": "string, second take-profit price",
      "win_probability": number 0-100,
      "y_percent": number 0-100,
      "rationale": "1-2 sentences on why this level is technically relevant",
      "invalidation": "short note on where this idea would be proven wrong"
    }
  ],
  "scenarios": [
    {
      "label": "short scenario name, e.g. 'Conservative / Risk Reduction'",
      "behavior": "1-2 sentences describing the market behavior that triggers this scenario, with specific price levels",
      "action": "1-2 sentences describing the recommended action a trader might take, with specific price levels"
    }
  ]
}
Exactly 3 objects in "entries" and exactly 3 in "scenarios". This is educational chart-reading practice, not financial advice — do not add disclaimers inside the JSON, just the structured analysis.`;

const GEMINI_MODEL = "gemini-3.6-flash"; // free-tier, multimodal

app.post("/api/analyze", async (req, res) => {
  try {
    const { base64, mediaType } = req.body || {};
    if (!base64 || !mediaType) {
      return res.status(400).json({ error: "Missing image data" });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mediaType, data: base64 } },
              { text: "Analyze this chart and return the JSON described in the system prompt. Only JSON, nothing else." },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 2500,
          responseMimeType: "application/json",
        },
      }),
    });

    const data = await response.json();

    if (data?.error) {
      return res.status(502).json({ error: data.error.message || "Gemini API error" });
    }

    const textBlock = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("\n")
      .trim();

    if (!textBlock) {
      const finishReason = data?.candidates?.[0]?.finishReason;
      return res.status(502).json({
        error: finishReason === "MAX_TOKENS"
          ? "Response got cut off before it finished (hit the token limit). Try again."
          : "Empty response from model",
      });
    }

    const cleaned = textBlock.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: "Couldn't parse the model's response as JSON." });
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Analysis failed" });
  }
});

// ---------------------------------------------------------------------------
// Trade tracking (select / resolve / history)
// ---------------------------------------------------------------------------

// Create a tracked trade (user tapped "Track this trade" on an entry)
app.post("/api/trades", async (req, res) => {
  try {
    const {
      instrument,
      label,
      direction,
      timing,
      timeframe,
      approxPrice,
      tp1,
      tp2,
      winProbability,
      rationale,
      invalidation,
    } = req.body || {};

    if (!direction || !approxPrice) {
      return res.status(400).json({ error: "Missing required trade fields" });
    }

    const trade = await Trade.create({
      instrument,
      label,
      direction,
      timing,
      timeframe,
      approxPrice,
      tp1,
      tp2,
      winProbability,
      rationale,
      invalidation,
    });

    res.status(201).json(trade);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Could not save trade" });
  }
});

// List trades. Optional ?status=open|win|loss
app.get("/api/trades", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const trades = await Trade.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(trades);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Could not load trades" });
  }
});

// Resolve a trade: { result: "win" | "loss" }
app.patch("/api/trades/:id", async (req, res) => {
  try {
    const { result } = req.body || {};
    if (!["win", "loss"].includes(result)) {
      return res.status(400).json({ error: "result must be 'win' or 'loss'" });
    }
    const trade = await Trade.findByIdAndUpdate(
      req.params.id,
      { status: result, resolvedAt: new Date() },
      { new: true }
    );
    if (!trade) return res.status(404).json({ error: "Trade not found" });
    res.json(trade);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Could not resolve trade" });
  }
});

// Delete a tracked/history trade
app.delete("/api/trades/:id", async (req, res) => {
  try {
    const deleted = await Trade.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Trade not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Could not delete trade" });
  }
});

// ---------------------------------------------------------------------------
// Serve the built frontend (npm run build -> dist/)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
