import { useState } from "react";

const ACCENT = "#dea4e0";
const ACCENT_DARK = "#c47ec6";
const ACCENT_GLOW = "#dea4e033";

const TBA_KEY = "d17WTHa0zN68kJsEhBMetnLCoAtGenwKrMm5hG1vU0O2O91ZfBZd8EzpXF9ks4E5";
const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const SB_BASE = "https://api.statbotics.io/v3";

// ── math helpers ──────────────────────────────────────────────────────────────
function normCDF(z) {
  const t = 1 / (1 + 0.2315419 * Math.abs(z));
  const d = 0.3989422820 * Math.exp(-0.5 * z * z);
  const poly = t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  const p = 1 - d * poly;
  return z >= 0 ? p : 1 - p;
}

async function fetchJSON(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function getBestYear() {
  try {
    const data = await fetchJSON(`${SB_BASE}/team_year/254/${new Date().getFullYear()}`);
    const auto = data?.epa?.breakdown?.auto_points;
    if (auto != null) return new Date().getFullYear();
  } catch {}
  return new Date().getFullYear() - 1;
}

async function getAutoEPA(team, year) {
  for (const y of [year, year - 1]) {
    try {
      const data = await fetchJSON(`${SB_BASE}/team_year/${team}/${y}`);
      const auto = data?.epa?.breakdown?.auto_points;
      if (auto != null) return { epa: auto, year: y };
    } catch {}
  }
  return null;
}

function extractAutoScores(matches, team) {
  const scores = [];
  for (const m of matches) {
    const bd = m?.score_breakdown;
    if (!bd) continue;
    for (const color of ["red", "blue"]) {
      const keys = m?.alliances?.[color]?.team_keys || [];
      if (keys.includes(`frc${team}`)) {
        const auto = bd?.[color]?.autoPoints;
        if (auto != null) scores.push(auto / 3);
        break;
      }
    }
  }
  return scores;
}

function calcSD(scores) {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1));
}

async function getAutoSD(team, eventKey, year, onLog = () => {}) {
  const h = { "X-TBA-Auth-Key": TBA_KEY };

  // 1. event — fetch all event matches, filter by team
  if (eventKey) {
    try {
      const matches = await fetchJSON(`${TBA_BASE}/event/${eventKey}/matches`, h);
      const scores = extractAutoScores(matches, team);
      onLog(`Team ${team} event matches found: ${scores.length}`);
      if (scores.length >= 2) {
        return { sd: scores.length >= 3 ? calcSD(scores) : scores[0] * 0.3, source: `event (${scores.length} matches)` };
      }
    } catch (e) { onLog(`Team ${team} event fetch error: ${e.message}`); }
  }

  // 2. season
  for (const y of [year, year - 1]) {
    try {
      const matches = await fetchJSON(`${TBA_BASE}/team/frc${team}/matches/${y}`, h);
      const scores = extractAutoScores(matches, team);
      if (scores.length >= 3) {
        return { sd: calcSD(scores), source: `${y} season (${scores.length} matches)` };
      }
    } catch {}
  }

  return { sd: null, source: "no data" };
}

async function computeWinProb(redTeams, blueTeams, eventKey, onLog) {
  const year = await getBestYear();
  onLog(`Using ${year} EPA data`);

  const redEPAs = [], blueEPAs = [];
  for (const t of redTeams) {
    const res = await getAutoEPA(t, year);
    if (res) { redEPAs.push(res.epa); onLog(`Team ${t} auto EPA: ${res.epa.toFixed(2)}${res.year !== year ? ` (from ${res.year})` : ""}`); }
    else onLog(`Team ${t}: no EPA found`);
  }
  for (const t of blueTeams) {
    const res = await getAutoEPA(t, year);
    if (res) { blueEPAs.push(res.epa); onLog(`Team ${t} auto EPA: ${res.epa.toFixed(2)}${res.year !== year ? ` (from ${res.year})` : ""}`); }
    else onLog(`Team ${t}: no EPA found`);
  }

  if (!redEPAs.length || !blueEPAs.length) return null;

  const redTotal = redEPAs.reduce((a, b) => a + b, 0);
  const blueTotal = blueEPAs.reduce((a, b) => a + b, 0);

  onLog(`Red alliance auto EPA: ${redTotal.toFixed(2)}`);
  onLog(`Blue alliance auto EPA: ${blueTotal.toFixed(2)}`);

  const allSDs = [];
  for (const t of [...redTeams, ...blueTeams]) {
    const { sd, source } = await getAutoSD(t, eventKey, year, onLog);
    if (sd != null) { allSDs.push(sd); onLog(`Team ${t} auto sd: ${sd.toFixed(2)} [${source}]`); }
    else onLog(`Team ${t}: no match variance data`);
  }

  let matchDiffSD;
  if (allSDs.length >= 3) {
    const meanSD = allSDs.reduce((a, b) => a + b, 0) / allSDs.length;
    matchDiffSD = meanSD * Math.sqrt(3) * Math.sqrt(2);
    onLog(`Match auto diff sd: ${matchDiffSD.toFixed(2)}`);
  } else {
    matchDiffSD = 10;
    onLog("Using fallback sd = 10");
  }

  const z = (redTotal - blueTotal) / matchDiffSD;
  const pRed = normCDF(z);
  return { pRed, pBlue: 1 - pRed, redTotal, blueTotal };
}

// ── components ────────────────────────────────────────────────────────────────
function TeamInput({ value, onChange, placeholder, color }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 5))}
      placeholder={placeholder}
      maxLength={5}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${color === "red" ? "#ff4d4d44" : color === "blue" ? "#4d7fff44" : "#dea4e044"}`,
        borderRadius: 8,
        color: "#fff",
        fontSize: 18,
        fontFamily: "'DM Mono', monospace",
        fontWeight: 500,
        padding: "10px 14px",
        width: "100%",
        outline: "none",
        transition: "border-color 0.2s, box-shadow 0.2s",
        boxSizing: "border-box",
      }}
      onFocus={e => {
        e.target.style.borderColor = color === "red" ? "#ff4d4d" : color === "blue" ? "#4d7fff" : ACCENT;
        e.target.style.boxShadow = `0 0 0 3px ${color === "red" ? "#ff4d4d22" : color === "blue" ? "#4d7fff22" : ACCENT_GLOW}`;
      }}
      onBlur={e => {
        e.target.style.borderColor = color === "red" ? "#ff4d4d44" : color === "blue" ? "#4d7fff44" : "#dea4e044";
        e.target.style.boxShadow = "none";
      }}
    />
  );
}

function ProbBar({ pRed, pBlue }) {
  const rPct = (pRed * 100).toFixed(1);
  const bPct = (pBlue * 100).toFixed(1);
  return (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div style={{ display: "flex", borderRadius: 12, overflow: "hidden", height: 36, boxShadow: "0 2px 16px #0006" }}>
        <div style={{
          width: `${rPct}%`, background: "linear-gradient(90deg, #c23232, #ff4d4d)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono', monospace",
          transition: "width 0.8s cubic-bezier(.4,0,.2,1)",
        }}>
          {rPct > 15 ? `${rPct}%` : ""}
        </div>
        <div style={{
          width: `${bPct}%`, background: "linear-gradient(90deg, #2244cc, #4d7fff)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono', monospace",
          transition: "width 0.8s cubic-bezier(.4,0,.2,1)",
        }}>
          {bPct > 15 ? `${bPct}%` : ""}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "#aaa", fontFamily: "'DM Mono', monospace" }}>
        <span style={{ color: "#ff6b6b" }}>RED {rPct}%</span>
        <span style={{ color: "#6b9fff" }}>BLUE {bPct}%</span>
      </div>
    </div>
  );
}

export default function App() {
  const [red, setRed] = useState(["", "", ""]);
  const [blue, setBlue] = useState(["", "", ""]);
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showLogs, setShowLogs] = useState(false);

  const updateRed = (i, v) => setRed(r => r.map((x, j) => j === i ? v : x));
  const updateBlue = (i, v) => setBlue(b => b.map((x, j) => j === i ? v : x));

  const canCompute = red.every(t => t.length >= 2) && blue.every(t => t.length >= 2);

  async function compute() {
    setLoading(true);
    setError(null);
    setResult(null);
    setLogs([]);
    setShowLogs(false);
    const logLines = [];
    const onLog = msg => { logLines.push(msg); setLogs([...logLines]); };
    try {
      const res = await computeWinProb(
        red.map(Number), blue.map(Number),
        event.trim() || null,
        onLog
      );
      if (!res) throw new Error("Insufficient data to compute probability.");
      setResult(res);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      backgroundImage: `radial-gradient(ellipse at 20% 10%, #2a0d2e55 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, #0d1a3a55 0%, transparent 60%)`,
      fontFamily: "'DM Sans', sans-serif",
      color: "#fff",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "40px 20px 60px",
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; }
        ::placeholder { color: #444 !important; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: ACCENT, fontFamily: "'DM Mono', monospace", marginBottom: 8, textTransform: "uppercase" }}>
          Team 8626 · Cyber Sailors
        </div>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: "clamp(42px, 8vw, 72px)",
          letterSpacing: 3,
          margin: 0,
          lineHeight: 1,
          background: `linear-gradient(135deg, #fff 40%, ${ACCENT})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          AUTO WIN CALC
        </h1>
        <div style={{ fontSize: 13, color: "#555", marginTop: 8, letterSpacing: 1 }}>
          Auto period win probability · powered by Statbotics + TBA
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: "100%",
        maxWidth: 680,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 20,
        padding: "32px 28px",
        backdropFilter: "blur(12px)",
        boxShadow: `0 0 60px ${ACCENT_GLOW}, 0 24px 48px #0008`,
      }}>

        {/* Event key */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase", fontFamily: "'DM Mono', monospace", display: "block", marginBottom: 8 }}>
            Event Key <span style={{ color: "#444" }}>(optional — e.g. 2026nebb)</span>
          </label>
          <input
            type="text"
            value={event}
            onChange={e => setEvent(e.target.value)}
            placeholder="leave blank for full season data"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${ACCENT_GLOW}`,
              borderRadius: 8,
              color: "#fff",
              fontSize: 15,
              fontFamily: "'DM Mono', monospace",
              padding: "10px 14px",
              width: "100%",
              outline: "none",
            }}
            onFocus={e => { e.target.style.borderColor = ACCENT; }}
            onBlur={e => { e.target.style.borderColor = "#dea4e033"; }}
          />
        </div>

        {/* Alliance inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Red */}
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, color: "#ff6b6b", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff4d4d", boxShadow: "0 0 8px #ff4d4d" }} />
              Red Alliance
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {red.map((v, i) => (
                <TeamInput key={i} value={v} onChange={val => updateRed(i, val)} placeholder={`Team ${i + 1}`} color="red" />
              ))}
            </div>
          </div>

          {/* Blue */}
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, color: "#6b9fff", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4d7fff", boxShadow: "0 0 8px #4d7fff" }} />
              Blue Alliance
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {blue.map((v, i) => (
                <TeamInput key={i} value={v} onChange={val => updateBlue(i, val)} placeholder={`Team ${i + 1}`} color="blue" />
              ))}
            </div>
          </div>
        </div>

        {/* Compute button */}
        <button
          onClick={compute}
          disabled={!canCompute || loading}
          style={{
            marginTop: 28,
            width: "100%",
            padding: "14px 0",
            borderRadius: 10,
            border: "none",
            background: canCompute && !loading
              ? `linear-gradient(135deg, ${ACCENT_DARK}, ${ACCENT})`
              : "#1a1a1a",
            color: canCompute && !loading ? "#1a0a1a" : "#333",
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "'DM Mono', monospace",
            letterSpacing: 2,
            textTransform: "uppercase",
            cursor: canCompute && !loading ? "pointer" : "not-allowed",
            transition: "all 0.2s",
            boxShadow: canCompute && !loading ? `0 0 24px ${ACCENT_GLOW}` : "none",
          }}
        >
          {loading ? "Computing..." : "Calculate Auto Win Prob"}
        </button>

        {/* Live logs while loading */}
        {loading && logs.length > 0 && (
          <div style={{
            marginTop: 16,
            background: "#0a0a0a",
            borderRadius: 8,
            padding: "12px 14px",
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: "#666",
            maxHeight: 120,
            overflowY: "auto",
          }}>
            {logs.map((l, i) => <div key={i} style={{ color: i === logs.length - 1 ? ACCENT : "#555" }}>› {l}</div>)}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: 16, padding: "12px 16px", background: "#ff4d4d11", border: "1px solid #ff4d4d33", borderRadius: 8, color: "#ff8080", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
            {error}
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div style={{ marginTop: 24 }}>
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 24 }} />

            <div style={{ fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 16 }}>
              Auto Period Result
            </div>

            <ProbBar pRed={result.pRed} pBlue={result.pBlue} />

            {/* Big numbers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
              {[
                { label: "Red Auto Win", pct: result.pRed, total: result.redTotal, color: "#ff4d4d", glow: "#ff4d4d33" },
                { label: "Blue Auto Win", pct: result.pBlue, total: result.blueTotal, color: "#4d7fff", glow: "#4d7fff33" },
              ].map(({ label, pct, total, color, glow }) => (
                <div key={label} style={{
                  background: `${color}08`,
                  border: `1px solid ${color}22`,
                  borderRadius: 12,
                  padding: "16px 20px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 11, color: "#666", fontFamily: "'DM Mono', monospace", letterSpacing: 1, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 36, fontFamily: "'Bebas Neue', sans-serif", color, letterSpacing: 2, lineHeight: 1, textShadow: `0 0 24px ${glow}` }}>
                    {(pct * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: "#555", fontFamily: "'DM Mono', monospace", marginTop: 6 }}>
                    EPA: {total.toFixed(2)} pts
                  </div>
                </div>
              ))}
            </div>

            {/* Toggle logs */}
            <button
              onClick={() => setShowLogs(s => !s)}
              style={{ marginTop: 16, background: "none", border: "none", color: "#444", fontSize: 11, fontFamily: "'DM Mono', monospace", cursor: "pointer", letterSpacing: 1 }}
            >
              {showLogs ? "▲ hide details" : "▼ show details"}
            </button>

            {showLogs && (
              <div style={{
                marginTop: 8,
                background: "#0a0a0a",
                borderRadius: 8,
                padding: "12px 14px",
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: "#555",
                maxHeight: 200,
                overflowY: "auto",
              }}>
                {logs.map((l, i) => <div key={i}>› {l}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 32, fontSize: 11, color: "#2a2a2a", fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>
        CYBER SAILORS · FRC 8626 · AUTO CALCULATOR
      </div>
    </div>
  );
}