import { useState, useRef, useEffect, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Upload,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Check,
  Clock,
  X,
} from "lucide-react";

const ACCENT_BUY = "#2FD48A";
const ACCENT_SELL = "#FF5C6C";
const BG = "#0B0E13";
const PANEL = "#12161F";
const LINE = "#232A38";
const TEXT = "#E6E9EF";
const MUTED = "#7C8797";

const TIMEFRAMES = [
  { value: "1m", minutes: 1 },
  { value: "5m", minutes: 5 },
  { value: "15m", minutes: 15 },
  { value: "1h", minutes: 60 },
  { value: "4h", minutes: 240 },
  { value: "1D", minutes: 1440 },
];

function winColor(pct) {
  if (pct >= 65) return ACCENT_BUY;
  if (pct >= 45) return "#E8B93F";
  return ACCENT_SELL;
}

function tfMinutes(tf) {
  return TIMEFRAMES.find((t) => t.value === tf)?.minutes || 15;
}

// Next aligned candle-close timestamp (ms) for a given timeframe, from "from" (ms).
function nextCandleClose(tf, from = Date.now()) {
  const periodMs = tfMinutes(tf) * 60 * 1000;
  return Math.ceil(from / periodMs) * periodMs;
}

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function entryKey(instrument, i, entry) {
  return `${instrument || "chart"}-${i}-${entry.approx_price}`;
}

export default function ChartEntryAnalyzer() {
  const [imageData, setImageData] = useState(null); // { base64, mediaType, url }
  const [status, setStatus] = useState("idle"); // idle | reading | loading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [timeframe, setTimeframe] = useState("15m");
  const [candleCloseAt, setCandleCloseAt] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [trackedKeys, setTrackedKeys] = useState(new Set());
  const [trackingKey, setTrackingKey] = useState(null);
  const [tradeError, setTradeError] = useState("");
  const [openTrades, setOpenTrades] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const fileInputRef = useRef(null);

  // Tick every second so candle-close countdowns update live.
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    refreshTrades();
  }, []);

  const candleReady = candleCloseAt !== null && nowTick >= candleCloseAt;
  const candleRemainingMs = candleCloseAt !== null ? candleCloseAt - nowTick : 0;

  const refreshTrades = async () => {
    try {
      const res = await fetch("/api/trades");
      if (!res.ok) return;
      const trades = await res.json();
      setOpenTrades(trades.filter((t) => t.status === "open"));
      setHistory(trades.filter((t) => t.status !== "open"));
    } catch (err) {
      console.error(err);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setStatus("reading");
    setResult(null);
    setErrorMsg("");
    setTradeError("");
    setTrackedKeys(new Set());
    setCandleCloseAt(null);

    const mediaType = file.type || "image/png";
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      setImageData({ base64, mediaType, url: dataUrl });
      setStatus("idle");
    };
    reader.onerror = () => {
      setErrorMsg("Couldn't read that file. Try a different image.");
      setStatus("error");
    };
    reader.readAsDataURL(file);
  };

  const runAnalysis = async () => {
    if (!imageData) return;
    setStatus("loading");
    setErrorMsg("");
    setResult(null);
    setTrackedKeys(new Set());
    setTradeError("");

    try {
      // NOTE: this calls OUR OWN backend (/api/analyze), which holds the
      // Gemini API key server-side and forwards the request. The browser
      // never sees the key.
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64: imageData.base64,
          mediaType: imageData.mediaType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || `Server error (${response.status})`);
      }

      if (!data.entries || data.entries.length === 0) {
        throw new Error("No entries returned");
      }

      setResult(data);
      // Lock "NOW" entries until the current candle on the selected timeframe closes.
      setCandleCloseAt(nextCandleClose(timeframe));
      setStatus("done");
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Analysis failed — try again.");
      setStatus("error");
    }
  };

  const reset = () => {
    setImageData(null);
    setResult(null);
    setStatus("idle");
    setErrorMsg("");
    setCandleCloseAt(null);
    setTrackedKeys(new Set());
    setTradeError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const trackEntry = async (entry, i) => {
    const key = entryKey(result?.instrument, i, entry);
    setTrackingKey(key);
    setTradeError("");
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: result?.instrument,
          label: entry.label,
          direction: entry.direction,
          timing: entry.timing,
          timeframe,
          approxPrice: entry.approx_price,
          tp1: entry.tp1,
          tp2: entry.tp2,
          winProbability: entry.win_probability,
          rationale: entry.rationale,
          invalidation: entry.invalidation,
        }),
      });
      const trade = await res.json();
      if (!res.ok) throw new Error(trade?.error || "Could not save trade");
      setOpenTrades((prev) => [trade, ...prev]);
      setTrackedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      console.error(err);
      setTradeError(err.message || "Could not track this trade.");
    } finally {
      setTrackingKey(null);
    }
  };

  const resolveTrade = async (id, outcome) => {
    try {
      const res = await fetch(`/api/trades/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: outcome }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated?.error || "Could not update trade");
      setOpenTrades((prev) => prev.filter((t) => t._id !== id));
      setHistory((prev) => [updated, ...prev]);
    } catch (err) {
      console.error(err);
      setTradeError(err.message || "Could not resolve this trade.");
    }
  };

  const stats = useMemo(() => {
    const wins = history.filter((t) => t.status === "win").length;
    const losses = history.filter((t) => t.status === "loss").length;
    const total = wins + losses;
    const rate = total > 0 ? Math.round((wins / total) * 100) : null;
    return { wins, losses, total, rate };
  }, [history]);

  return (
    <div
      style={{
        minHeight: "100%",
        background: BG,
        color: TEXT,
        fontFamily: "'Inter', system-ui, sans-serif",
        padding: "28px 20px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .btn { transition: opacity 0.15s ease, transform 0.1s ease; cursor: pointer; }
        .btn:hover { opacity: 0.88; }
        .btn:active { transform: scale(0.98); }
        .btn:disabled { cursor: not-allowed; opacity: 0.5; }
        .btn:disabled:hover { opacity: 0.5; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .card { transition: border-color 0.15s ease; }
        .scenario-row { grid-template-columns: 1fr 1fr 1fr; }
        @media (max-width: 480px) {
          .scenario-row { grid-template-columns: 1fr !important; gap: 4px !important; }
          .scenario-row > div:first-child { margin-bottom: 2px; }
        }
      `}</style>

      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
            Chart entry reader
          </h1>
          <p style={{ color: MUTED, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
            Upload a chart screenshot. Gemini reads the visible structure and marks three
            possible entry points with the reasoning behind each.
          </p>
        </header>

        {/* Timeframe selector — drives the candle-close gate below */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 14,
            background: PANEL,
            border: `1px solid ${LINE}`,
            borderRadius: 12,
            padding: "10px 14px",
          }}
        >
          <div style={{ fontSize: 13, color: MUTED }}>Chart timeframe</div>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="mono"
            style={{
              background: BG,
              color: TEXT,
              border: `1px solid ${LINE}`,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf.value} value={tf.value}>
                {tf.value}
              </option>
            ))}
          </select>
        </div>

        {!imageData && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className="btn"
            style={{
              border: `1.5px dashed ${LINE}`,
              borderRadius: 14,
              padding: "48px 20px",
              textAlign: "center",
              background: PANEL,
            }}
          >
            <Upload size={26} color={MUTED} style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 15, fontWeight: 500 }}>Drop a chart image, or tap to choose one</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>PNG or JPG screenshot</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
        )}

        {imageData && (
          <div>
            <div
              className="card"
              style={{
                position: "relative",
                borderRadius: 14,
                overflow: "hidden",
                border: `1px solid ${LINE}`,
                background: "#000",
              }}
            >
              <img src={imageData.url} alt="uploaded chart" style={{ width: "100%", display: "block" }} />

              {status === "done" &&
                result?.entries?.map((entry, i) => {
                  const isBuy = entry.direction === "buy";
                  const color = isBuy ? ACCENT_BUY : ACCENT_SELL;
                  return (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: `${Math.min(98, Math.max(2, entry.y_percent))}%`,
                        transform: "translateY(-50%)",
                        pointerEvents: "none",
                      }}
                    >
                      <div
                        style={{
                          borderTop: `1.5px dashed ${color}`,
                          width: "100%",
                          opacity: 0.85,
                        }}
                      />
                      <div
                        className="mono"
                        style={{
                          position: "absolute",
                          left: 8,
                          top: -11,
                          background: color,
                          color: "#08110D",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 5,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        {isBuy ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {i + 1} · {entry.approx_price}
                        {typeof entry.win_probability === "number" && (
                          <span style={{ opacity: 0.85 }}>· {entry.win_probability}%</span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              {status !== "loading" && status !== "done" && (
                <button
                  onClick={runAnalysis}
                  className="btn"
                  style={{
                    flex: 1,
                    background: "#3B82F6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "12px 16px",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  Analyze chart
                </button>
              )}
              {status === "loading" && (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: PANEL,
                    border: `1px solid ${LINE}`,
                    borderRadius: 10,
                    padding: "12px 16px",
                    fontSize: 14,
                    color: MUTED,
                  }}
                >
                  <Loader2 size={16} className="spin" /> Reading chart structure…
                </div>
              )}
              <button
                onClick={reset}
                className="btn"
                style={{
                  background: "transparent",
                  border: `1px solid ${LINE}`,
                  color: MUTED,
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RefreshCw size={14} /> New image
              </button>
            </div>

            {status === "error" && (
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  color: ACCENT_SELL,
                  fontSize: 13,
                  background: "rgba(255,92,108,0.08)",
                  border: `1px solid rgba(255,92,108,0.25)`,
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{errorMsg}</span>
              </div>
            )}

            {tradeError && (
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  color: ACCENT_SELL,
                  fontSize: 13,
                  background: "rgba(255,92,108,0.08)",
                  border: `1px solid rgba(255,92,108,0.25)`,
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{tradeError}</span>
              </div>
            )}

            {status === "done" && result && (
              <div style={{ marginTop: 20 }}>
                {result.instrument && (
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 4 }}>
                    Reading for <span style={{ color: TEXT, fontWeight: 600 }}>{result.instrument}</span>
                  </div>
                )}
                {result.chart_summary && (
                  <p style={{ fontSize: 14, lineHeight: 1.55, color: TEXT, marginTop: 4, marginBottom: 12 }}>
                    {result.chart_summary}
                  </p>
                )}

                {!candleReady && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12.5,
                      color: "#E8B93F",
                      background: "rgba(232,185,63,0.1)",
                      border: "1px solid rgba(232,185,63,0.3)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      marginBottom: 14,
                    }}
                  >
                    <Clock size={14} style={{ flexShrink: 0 }} />
                    <span>
                      Entries marked <strong>LIVE</strong> are locked until this {timeframe} candle
                      closes — wait for confirmation before entering.{" "}
                      <span className="mono">{formatCountdown(candleRemainingMs)}</span> left.
                    </span>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.entries.map((entry, i) => {
                    const isBuy = entry.direction === "buy";
                    const color = isBuy ? ACCENT_BUY : ACCENT_SELL;
                    const hasWinPct = typeof entry.win_probability === "number";
                    const wColor = hasWinPct ? winColor(entry.win_probability) : MUTED;
                    const key = entryKey(result.instrument, i, entry);
                    const tracked = trackedKeys.has(key);
                    const gatedByCandle = entry.timing === "NOW" && !candleReady;
                    const isTrackingThis = trackingKey === key;

                    return (
                      <div
                        key={i}
                        className="card"
                        style={{
                          background: PANEL,
                          border: `1px solid ${LINE}`,
                          borderRadius: 12,
                          padding: "14px 16px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              className="mono"
                              style={{
                                background: color,
                                color: "#08110D",
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: 5,
                              }}
                            >
                              {i + 1}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{entry.label}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {hasWinPct && (
                              <span
                                className="mono"
                                title="Model's subjective confidence read, not a statistical win rate"
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  letterSpacing: "0.02em",
                                  padding: "2px 7px",
                                  borderRadius: 5,
                                  background: `${wColor}26`,
                                  color: wColor,
                                }}
                              >
                                {entry.win_probability}% conf.
                              </span>
                            )}
                            {entry.timing && (
                              <span
                                className="mono"
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  letterSpacing: "0.02em",
                                  padding: "2px 7px",
                                  borderRadius: 5,
                                  background: entry.timing === "NOW" ? "rgba(47,212,138,0.15)" : "rgba(124,135,151,0.15)",
                                  color: entry.timing === "NOW" ? ACCENT_BUY : MUTED,
                                }}
                              >
                                {entry.timing === "NOW" ? "LIVE" : "WAIT"}
                              </span>
                            )}
                          </div>
                        </div>

                        {hasWinPct && (
                          <div
                            style={{
                              height: 5,
                              borderRadius: 3,
                              background: "rgba(255,255,255,0.06)",
                              marginBottom: 10,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${Math.min(100, Math.max(0, entry.win_probability))}%`,
                                background: wColor,
                                borderRadius: 3,
                              }}
                            />
                          </div>
                        )}

                        <div
                          className="mono"
                          style={{
                            fontSize: 13.5,
                            marginBottom: 10,
                            padding: "10px 12px",
                            background: "rgba(255,255,255,0.03)",
                            borderRadius: 8,
                            border: `1px solid ${LINE}`,
                            color: TEXT,
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 5,
                          }}
                        >
                          <span style={{ color, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
                            {isBuy ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                            ENTRY : {entry.timing === "NOW" ? "NOW" : "WAIT"} at {entry.approx_price}
                          </span>
                          {(entry.tp1 || entry.tp2) && <span>and</span>}
                          {entry.tp1 && <span>TP 1 :{entry.tp1}</span>}
                          {entry.tp2 && <span>TP2: {entry.tp2}</span>}
                        </div>

                        <p style={{ fontSize: 13, color: TEXT, lineHeight: 1.5, margin: "0 0 6px 0" }}>
                          {entry.rationale}
                        </p>
                        {entry.invalidation && (
                          <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: "0 0 10px 0" }}>
                            Invalidated if: {entry.invalidation}
                          </p>
                        )}

                        {entry.timing === "WAIT" && (
                          <p style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.4, margin: "0 0 10px 0" }}>
                            Pending level — this only becomes relevant if price actually reaches it.
                          </p>
                        )}

                        <button
                          onClick={() => trackEntry(entry, i)}
                          disabled={tracked || gatedByCandle || isTrackingThis}
                          className="btn"
                          style={{
                            width: "100%",
                            background: tracked ? "rgba(47,212,138,0.12)" : gatedByCandle ? "transparent" : color,
                            color: tracked ? ACCENT_BUY : gatedByCandle ? MUTED : "#08110D",
                            border: tracked ? `1px solid ${ACCENT_BUY}` : gatedByCandle ? `1px solid ${LINE}` : "none",
                            borderRadius: 8,
                            padding: "9px 12px",
                            fontSize: 12.5,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          {tracked ? (
                            <>
                              <Check size={13} /> Tracked
                            </>
                          ) : isTrackingThis ? (
                            <>
                              <Loader2 size={13} className="spin" /> Adding…
                            </>
                          ) : gatedByCandle ? (
                            <>
                              <Clock size={13} /> Wait {formatCountdown(candleRemainingMs)} for candle close
                            </>
                          ) : (
                            "Track this trade"
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {result.scenarios && result.scenarios.length > 0 && (
                  <div style={{ marginTop: 26 }}>
                    <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px 0" }}>
                      Potential execution scenarios
                    </h2>
                    <div
                      className="scenario-row"
                      style={{
                        display: "grid",
                        gap: "10px 16px",
                        fontSize: 12,
                        color: MUTED,
                        fontWeight: 600,
                        paddingBottom: 8,
                        borderBottom: `1px solid ${LINE}`,
                        marginBottom: 4,
                      }}
                    >
                      <div>Scenario</div>
                      <div>Market behavior</div>
                      <div>Recommended action</div>
                    </div>
                    {result.scenarios.map((sc, i) => (
                      <div
                        key={i}
                        className="scenario-row"
                        style={{
                          display: "grid",
                          gap: "10px 16px",
                          padding: "14px 0",
                          borderBottom: i < result.scenarios.length - 1 ? `1px solid ${LINE}` : "none",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
                          {String.fromCharCode(65 + i)}. {sc.label}
                        </div>
                        <div style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.5 }}>{sc.behavior}</div>
                        <div style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.5 }}>{sc.action}</div>
                      </div>
                    ))}
                  </div>
                )}

                <p style={{ fontSize: 11.5, color: MUTED, marginTop: 16, lineHeight: 1.5 }}>
                  Chart-reading practice only, not financial advice. Price levels, positions, and
                  confidence percentages are estimated visually from the screenshot — the "% conf."
                  badge reflects the model's subjective read of technical confluence, not a
                  statistical or backtested win rate.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------ */}
        {/* Open trades                                                   */}
        {/* ------------------------------------------------------------ */}
        {openTrades.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px 0" }}>
              Open trades ({openTrades.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {openTrades.map((t) => {
                const isBuy = t.direction === "buy";
                const color = isBuy ? ACCENT_BUY : ACCENT_SELL;
                return (
                  <div
                    key={t._id}
                    className="card"
                    style={{
                      background: PANEL,
                      border: `1px solid ${LINE}`,
                      borderRadius: 12,
                      padding: "12px 14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        {isBuy ? <TrendingUp size={13} color={color} /> : <TrendingDown size={13} color={color} />}
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                          {t.instrument || "Unnamed"} — {t.label}
                        </span>
                      </div>
                      <div className="mono" style={{ fontSize: 12, color: MUTED }}>
                        {t.timing} @ {t.approxPrice} · TP1 {t.tp1 || "—"} · TP2 {t.tp2 || "—"}
                        {t.timeframe ? ` · ${t.timeframe}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => resolveTrade(t._id, "win")}
                        className="btn"
                        style={{
                          background: "rgba(47,212,138,0.12)",
                          color: ACCENT_BUY,
                          border: `1px solid ${ACCENT_BUY}`,
                          borderRadius: 8,
                          padding: "7px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        Win
                      </button>
                      <button
                        onClick={() => resolveTrade(t._id, "loss")}
                        className="btn"
                        style={{
                          background: "rgba(255,92,108,0.12)",
                          color: ACCENT_SELL,
                          border: `1px solid ${ACCENT_SELL}`,
                          borderRadius: 8,
                          padding: "7px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        Loss
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------ */}
        {/* History                                                       */}
        {/* ------------------------------------------------------------ */}
        <div style={{ marginTop: 28 }}>
          <div
            onClick={() => setShowHistory((s) => !s)}
            className="btn"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 15,
              fontWeight: 700,
              marginBottom: showHistory ? 12 : 0,
            }}
          >
            <span>
              History{stats.total > 0 ? ` — ${stats.wins}W / ${stats.losses}L (${stats.rate}%)` : ""}
            </span>
            <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>
              {showHistory ? "Hide" : "Show"}
            </span>
          </div>

          {showHistory && (
            history.length === 0 ? (
              <p style={{ fontSize: 13, color: MUTED }}>No resolved trades yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {history.map((t) => {
                  const isBuy = t.direction === "buy";
                  const won = t.status === "win";
                  return (
                    <div
                      key={t._id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "9px 12px",
                        background: PANEL,
                        border: `1px solid ${LINE}`,
                        borderRadius: 10,
                        fontSize: 12.5,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        {isBuy ? (
                          <TrendingUp size={13} color={ACCENT_BUY} />
                        ) : (
                          <TrendingDown size={13} color={ACCENT_SELL} />
                        )}
                        <span style={{ fontWeight: 600 }}>{t.instrument || "Unnamed"}</span>
                        <span className="mono" style={{ color: MUTED }}>
                          {t.approxPrice}
                        </span>
                        <span style={{ color: MUTED }}>
                          {new Date(t.resolvedAt || t.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <span
                        className="mono"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontWeight: 700,
                          color: won ? ACCENT_BUY : ACCENT_SELL,
                        }}
                      >
                        {won ? <Check size={13} /> : <X size={13} />}
                        {won ? "WIN" : "LOSS"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
