import { useState, useEffect, useCallback } from "react";

const ACCENT = "#dea4e0";
const ACCENT_DARK = "#c47ec6";
const ACCENT_GLOW = "#dea4e033";

const TBA_KEY = "d17WTHa0zN68kJsEhBMetnLCoAtGenwKrMm5hG1vU0O2O91ZfBZd8EzpXF9ks4E5";
const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const SB_BASE = "https://api.statbotics.io/v3";
const TBA_H = { "X-TBA-Auth-Key": TBA_KEY };

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
    if (data?.epa?.breakdown?.auto_points != null) return new Date().getFullYear();
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
        const auto = bd?.[color]?.autoPoints ?? bd?.[color]?.totalAutoPoints;
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
  if (eventKey) {
    try {
      const matches = await fetchJSON(`${TBA_BASE}/event/${eventKey}/matches`, TBA_H);
      const scores = extractAutoScores(matches, team);
      onLog(`Team ${team} event matches found: ${scores.length}`);
      if (scores.length >= 2) {
        return { sd: scores.length >= 3 ? calcSD(scores) : scores[0] * 0.3, source: `event (${scores.length} matches)` };
      }
    } catch (e) { onLog(`Team ${team} event fetch error: ${e.message}`); }
  }
  for (const y of [year, year - 1]) {
    try {
      const matches = await fetchJSON(`${TBA_BASE}/team/frc${team}/matches/${y}`, TBA_H);
      const scores = extractAutoScores(matches, team);
      if (scores.length >= 3) return { sd: calcSD(scores), source: `${y} season (${scores.length} matches)` };
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
  return { pRed: normCDF(z), pBlue: 1 - normCDF(z), redTotal, blueTotal };
}

// ── shared styles ──────────────────────────────────────────────────────────────
const inputStyle = (active) => ({
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${active ? ACCENT : ACCENT_GLOW}`,
  borderRadius: 8, color: "#fff", fontSize: 15,
  fontFamily: "'DM Mono', monospace",
  padding: "10px 14px", width: "100%", outline: "none",
  boxSizing: "border-box",
  boxShadow: active ? `0 0 0 3px ${ACCENT_GLOW}` : "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
});

const selectStyle = {
  background: "#0f0f16", border: `1px solid ${ACCENT_GLOW}`,
  borderRadius: 8, color: "#fff", fontSize: 14,
  fontFamily: "'DM Mono', monospace", padding: "10px 14px",
  width: "100%", outline: "none", cursor: "pointer",
  appearance: "none", WebkitAppearance: "none",
};

function TeamInput({ value, onChange, onEnter, placeholder, color }) {
  const borderColor = color === "red" ? "#ff4d4d" : "#4d7fff";
  const borderFaint = color === "red" ? "#ff4d4d44" : "#4d7fff44";
  const glowColor = color === "red" ? "#ff4d4d22" : "#4d7fff22";
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 5))}
      onKeyDown={e => e.key === "Enter" && onEnter?.()}
      placeholder={placeholder}
      maxLength={5}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${borderFaint}`,
        borderRadius: 8, color: "#fff", fontSize: 18,
        fontFamily: "'DM Mono', monospace", fontWeight: 500,
        padding: "10px 14px", width: "100%", outline: "none",
        transition: "border-color 0.2s, box-shadow 0.2s", boxSizing: "border-box",
      }}
      onFocus={e => { e.target.style.borderColor = borderColor; e.target.style.boxShadow = `0 0 0 3px ${glowColor}`; }}
      onBlur={e => { e.target.style.borderColor = borderFaint; e.target.style.boxShadow = "none"; }}
    />
  );
}

function ProbBar({ pRed, pBlue }) {
  const rPct = (pRed * 100).toFixed(1);
  const bPct = (pBlue * 100).toFixed(1);
  return (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div style={{ display: "flex", borderRadius: 12, overflow: "hidden", height: 36, boxShadow: "0 2px 16px #0006" }}>
        <div style={{ width: `${rPct}%`, background: "linear-gradient(90deg, #c23232, #ff4d4d)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono', monospace", transition: "width 0.8s cubic-bezier(.4,0,.2,1)" }}>
          {rPct > 15 ? `${rPct}%` : ""}
        </div>
        <div style={{ width: `${bPct}%`, background: "linear-gradient(90deg, #2244cc, #4d7fff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono', monospace", transition: "width 0.8s cubic-bezier(.4,0,.2,1)" }}>
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

// ── Match Simulator ────────────────────────────────────────────────────────────
function MatchSimulator({ onLoad }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2014 }, (_, i) => currentYear - i);

  const [year, setYear] = useState(currentYear);
  const [districts, setDistricts] = useState([]);
  const [selectedDistrict, setSelectedDistrict] = useState("__all__");
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState("");
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);

  // Load districts when year changes
  useEffect(() => {
    setDistricts([]); setSelectedDistrict("__all__");
    setEvents([]); setSelectedEvent("");
    setMatches([]); setSelectedMatch("");
    setLoadingDistricts(true);
    fetchJSON(`${TBA_BASE}/districts/${year}`, TBA_H)
      .then(d => setDistricts(d.sort((a, b) => a.display_name.localeCompare(b.display_name))))
      .catch(() => setDistricts([]))
      .finally(() => setLoadingDistricts(false));
  }, [year]);

  // Load events when district or year changes
  useEffect(() => {
    setEvents([]); setSelectedEvent("");
    setMatches([]); setSelectedMatch("");
    setLoadingEvents(true);
    // Always fetch all year events so we can include pre/offseason (types 99, 100)
    const allPromise = fetchJSON(`${TBA_BASE}/events/${year}/simple`, TBA_H).catch(() => []);
    const districtPromise = selectedDistrict !== "__all__"
      ? fetchJSON(`${TBA_BASE}/district/${selectedDistrict}/events/simple`, TBA_H).catch(() => [])
      : Promise.resolve(null);
    // District key → state abbreviations in that district
    const DISTRICT_STATES = {
      ne: ["MA","ME","NH","VT","RI","CT"],
      chs: ["VA","MD","DC"],
      fim: ["MI"],
      fit: ["TX"],
      fnc: ["NC"],
      fma: ["NJ","PA","DE"],
      fin: ["IN"],
      isr: ["IL"],
      pnw: ["OR","WA"],
      pch: ["GA","AL"],
      cal: ["CA"],
      ont: ["ON"],
    };

    Promise.all([allPromise, districtPromise]).then(([all, districtEvents]) => {
      let filtered;
      if (selectedDistrict === "__all__") {
        filtered = all;
      } else {
        const districtKeys = new Set((districtEvents || []).map(e => e.key));
        // Get state codes for this district (strip year prefix, e.g. "2026ne" -> "ne")
        const districtCode = selectedDistrict.replace(/^\d+/, "");
        const states = DISTRICT_STATES[districtCode] || [];
        filtered = all.filter(e =>
          districtKeys.has(e.key) ||
          ((e.event_type === 99 || e.event_type === 100) && states.includes(e.state_prov))
        );
      }
      const TYPE_LABEL = { 99: "[Offseason] ", 100: "[Preseason] " };
      filtered.sort((a, b) => {
        const oa = a.event_type === 100 ? -1 : a.event_type === 99 ? 1 : 0;
        const ob = b.event_type === 100 ? -1 : b.event_type === 99 ? 1 : 0;
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      });
      setEvents(filtered.map(e => ({ ...e, displayName: (TYPE_LABEL[e.event_type] || "") + e.name })));
    }).finally(() => setLoadingEvents(false));
  }, [year, selectedDistrict]);

  // Load matches when event changes
  useEffect(() => {
    if (!selectedEvent) { setMatches([]); setSelectedMatch(""); return; }
    setMatches([]); setSelectedMatch("");
    setLoadingMatches(true);
    fetchJSON(`${TBA_BASE}/event/${selectedEvent}/matches`, TBA_H)
      .then(d => {
        const sorted = d.sort((a, b) => {
          const order = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
          if (a.comp_level !== b.comp_level) return (order[a.comp_level] ?? 5) - (order[b.comp_level] ?? 5);
          if (a.set_number !== b.set_number) return a.set_number - b.set_number;
          return a.match_number - b.match_number;
        });
        setMatches(sorted);
      })
      .catch(() => setMatches([]))
      .finally(() => setLoadingMatches(false));
  }, [selectedEvent]);

  const selectedMatchData = matches.find(m => m.key === selectedMatch);

  function matchLabel(m) {
    const lvl = { qm: "Qual", ef: "EF", qf: "QF", sf: "SF", f: "Final" }[m.comp_level] || m.comp_level.toUpperCase();
    if (m.comp_level === "qm") return `${lvl} ${m.match_number}`;
    return `${lvl} ${m.set_number}M${m.match_number}`;
  }

  function handleLoad() {
    if (!selectedMatchData) return;
    const red = selectedMatchData.alliances.red.team_keys.map(k => k.replace("frc", ""));
    const blue = selectedMatchData.alliances.blue.team_keys.map(k => k.replace("frc", ""));
    onLoad({ red, blue, eventKey: selectedEvent, matchKey: selectedMatch });
  }

  const labelStyle = { fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase", fontFamily: "'DM Mono', monospace", display: "block", marginBottom: 6 };

  return (
    <div style={{ width: "100%", maxWidth: 680, marginTop: 20 }}>
      <div style={{ background: "rgba(255,255,255,0.03)", border: `2px solid ${ACCENT}44`, borderRadius: 20, padding: "28px 28px" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: ACCENT, textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 20 }}>
          Match Simulator
        </div>

        {/* Row 1: Year + District */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Year</label>
            <select style={selectStyle} value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>District {loadingDistricts && <span style={{ color: "#555" }}>loading...</span>}</label>
            <select style={selectStyle} value={selectedDistrict} onChange={e => setSelectedDistrict(e.target.value)}>
              <option value="__all__">All Events</option>
              {districts.map(d => <option key={d.key} value={d.key}>{d.display_name}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Event */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Event {loadingEvents && <span style={{ color: "#555" }}>loading...</span>}</label>
          <select style={selectStyle} value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}>
            <option value="">— select an event —</option>
            {events.map(e => <option key={e.key} value={e.key}>{e.displayName || e.name}</option>)}
          </select>
        </div>

        {/* Row 3: Match */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Match {loadingMatches && <span style={{ color: "#555" }}>loading...</span>}</label>
          <select style={selectStyle} value={selectedMatch} onChange={e => setSelectedMatch(e.target.value)} disabled={!matches.length}>
            <option value="">— select a match —</option>
            {matches.map(m => <option key={m.key} value={m.key}>{matchLabel(m)}</option>)}
          </select>
        </div>

        {/* Preview */}
        {selectedMatchData && (() => {
          const bd = selectedMatchData.score_breakdown;
          const autoRed = bd?.red?.autoPoints ?? bd?.red?.totalAutoPoints ?? null;
          const autoBlue = bd?.blue?.autoPoints ?? bd?.blue?.totalAutoPoints ?? null;
          const autoWinner = autoRed != null && autoBlue != null
            ? (autoRed > autoBlue ? "red" : autoBlue > autoRed ? "blue" : "tie")
            : null;
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {["red", "blue"].map(color => {
                const won = autoWinner === color;
                const c = color === "red" ? "#ff4d4d" : "#4d7fff";
                const autoScore = color === "red" ? autoRed : autoBlue;
                return (
                  <div key={color} style={{
                    background: won ? `${c}18` : `${c}08`,
                    border: won ? `2px solid ${c}` : `1px solid ${c}33`,
                    borderRadius: 10, padding: "12px 16px",
                    boxShadow: won ? `0 0 18px ${c}55` : "none",
                    transition: "all 0.3s",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: color === "red" ? "#ff6b6b" : "#6b9fff", fontFamily: "'DM Mono', monospace", letterSpacing: 1, textTransform: "uppercase" }}>
                        {color} alliance
                      </div>
                      {won && <div style={{ fontSize: 9, color: c, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>AUTO WINNER</div>}
                    </div>
                    {selectedMatchData.alliances[color].team_keys.map(k => (
                      <div key={k} style={{ fontSize: 14, fontFamily: "'DM Mono', monospace", color: "#ccc", marginBottom: 2 }}>{k.replace("frc", "Team ")}</div>
                    ))}
                    {autoScore != null && (
                      <div style={{ fontSize: 11, color: won ? c : "#444", fontFamily: "'DM Mono', monospace", marginTop: 8 }}>
                        Auto: {autoScore} pts
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {selectedMatchData && (
          <div style={{ marginBottom: 16, fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#444" }}>
            Match key: <span style={{ color: "#666" }}>{selectedMatch}</span>
          </div>
        )}

        <button
          onClick={handleLoad}
          disabled={!selectedMatchData}
          style={{
            width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
            background: selectedMatchData ? `linear-gradient(135deg, ${ACCENT_DARK}, ${ACCENT})` : "#1a1a1a",
            color: selectedMatchData ? "#1a0a1a" : "#333",
            fontSize: 13, fontWeight: 700, fontFamily: "'DM Mono', monospace",
            letterSpacing: 2, textTransform: "uppercase",
            cursor: selectedMatchData ? "pointer" : "not-allowed",
            boxShadow: selectedMatchData ? `0 0 24px ${ACCENT_GLOW}` : "none",
          }}
        >
          Load Teams into Calculator ↑
        </button>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [red, setRed] = useState(["", "", ""]);
  const [blue, setBlue] = useState(["", "", ""]);
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [eventFocused, setEventFocused] = useState(false);

  const updateRed = (i, v) => setRed(r => r.map((x, j) => j === i ? v : x));
  const updateBlue = (i, v) => setBlue(b => b.map((x, j) => j === i ? v : x));

  const canCompute = red.every(t => t.length >= 2) && blue.every(t => t.length >= 2);

  const compute = useCallback(async () => {
    if (!canCompute || loading) return;
    setLoading(true); setError(null); setResult(null); setLogs([]); setShowLogs(false);
    const logLines = [];
    const onLog = msg => { logLines.push(msg); setLogs([...logLines]); };
    try {
      const res = await computeWinProb(red.map(Number), blue.map(Number), event.trim() || null, onLog);
      if (!res) throw new Error("Insufficient data to compute probability.");
      setResult(res);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [canCompute, loading, red, blue, event]);

  function handleSimLoad({ red: r, blue: b, eventKey, matchKey }) {
    setRed(r); setBlue(b); setEvent(eventKey);
    setResult(null); setError(null); setLogs([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", fontFamily: "'DM Sans', sans-serif", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px 60px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0a0a0f; }
        ::placeholder { color: #444 !important; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; }
        select option { background: #0f0f16; }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: ACCENT, fontFamily: "'DM Mono', monospace", marginBottom: 8, textTransform: "uppercase" }}>Team 8626 · Cyber Sailors</div>
        <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(42px, 8vw, 72px)", letterSpacing: 3, margin: 0, lineHeight: 1, background: `linear-gradient(135deg, #fff 40%, ${ACCENT})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          AUTO WIN CALC
        </h1>
        <div style={{ fontSize: 13, color: "#555", marginTop: 8, letterSpacing: 1 }}>Auto period win probability · powered by Statbotics + TBA</div>
      </div>

      {/* Main card */}
      <div style={{ width: "100%", maxWidth: 680, background: "rgba(255,255,255,0.03)", border: `2px solid ${ACCENT}88`, borderRadius: 20, padding: "32px 28px", backdropFilter: "blur(12px)", boxShadow: `0 24px 48px #0008` }}>

        {/* Event key */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase", fontFamily: "'DM Mono', monospace", display: "block", marginBottom: 8 }}>
            Event Key <span style={{ color: "#444" }}>(optional — e.g. 2026nebb)</span>
          </label>
          <input
            type="text" value={event}
            onChange={e => setEvent(e.target.value)}
            onKeyDown={e => e.key === "Enter" && compute()}
            onFocus={() => setEventFocused(true)}
            onBlur={() => setEventFocused(false)}
            placeholder="leave blank for full season data"
            style={inputStyle(eventFocused)}
          />
        </div>

        {/* Alliance inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, color: "#ff6b6b", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 12, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff4d4d", boxShadow: "0 0 8px #ff4d4d" }} /> Red Alliance
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {red.map((v, i) => <TeamInput key={i} value={v} onChange={val => updateRed(i, val)} onEnter={compute} placeholder={`Team ${i + 1}`} color="red" />)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, color: "#6b9fff", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 12, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4d7fff", boxShadow: "0 0 8px #4d7fff" }} /> Blue Alliance
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {blue.map((v, i) => <TeamInput key={i} value={v} onChange={val => updateBlue(i, val)} onEnter={compute} placeholder={`Team ${i + 1}`} color="blue" />)}
            </div>
          </div>
        </div>

        {/* Button */}
        <button onClick={compute} disabled={!canCompute || loading} style={{ marginTop: 28, width: "100%", padding: "14px 0", borderRadius: 10, border: "none", background: canCompute && !loading ? `linear-gradient(135deg, ${ACCENT_DARK}, ${ACCENT})` : "#1a1a1a", color: canCompute && !loading ? "#1a0a1a" : "#333", fontSize: 14, fontWeight: 700, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: "uppercase", cursor: canCompute && !loading ? "pointer" : "not-allowed", transition: "all 0.2s", boxShadow: canCompute && !loading ? `0 0 24px ${ACCENT_GLOW}` : "none" }}>
          {loading ? "Computing..." : "Calculate Auto Win Prob"}
        </button>

        {/* Live logs */}
        {loading && logs.length > 0 && (
          <div style={{ marginTop: 16, background: "#0a0a0a", borderRadius: 8, padding: "12px 14px", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#666", maxHeight: 120, overflowY: "auto" }}>
            {logs.map((l, i) => <div key={i} style={{ color: i === logs.length - 1 ? ACCENT : "#555" }}>› {l}</div>)}
          </div>
        )}

        {/* Error */}
        {error && <div style={{ marginTop: 16, padding: "12px 16px", background: "#ff4d4d11", border: "1px solid #ff4d4d33", borderRadius: 8, color: "#ff8080", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{error}</div>}

        {/* Result */}
        {result && !loading && (
          <div style={{ marginTop: 24 }}>
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 24 }} />
            <div style={{ fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 16 }}>Auto Period Result</div>
            <ProbBar pRed={result.pRed} pBlue={result.pBlue} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
              {[
                { label: "Red Auto Win", pct: result.pRed, total: result.redTotal, color: "#ff4d4d", glow: "#ff4d4d33" },
                { label: "Blue Auto Win", pct: result.pBlue, total: result.blueTotal, color: "#4d7fff", glow: "#4d7fff33" },
              ].map(({ label, pct, total, color, glow }) => (
                <div key={label} style={{ background: `${color}08`, border: `1px solid ${color}22`, borderRadius: 12, padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#666", fontFamily: "'DM Mono', monospace", letterSpacing: 0, marginBottom: 6, whiteSpace: "nowrap" }}>{label}</div>
                  <div style={{ fontSize: 36, fontFamily: "'Bebas Neue', sans-serif", color, letterSpacing: 2, lineHeight: 1, textShadow: `0 0 24px ${glow}` }}>{(pct * 100).toFixed(1)}%</div>
                  <div style={{ fontSize: 11, color: "#555", fontFamily: "'DM Mono', monospace", marginTop: 6 }}>EPA: {total.toFixed(2)} pts</div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowLogs(s => !s)} style={{ marginTop: 16, background: "none", border: "none", color: "#444", fontSize: 11, fontFamily: "'DM Mono', monospace", cursor: "pointer", letterSpacing: 1 }}>
              {showLogs ? "▲ hide details" : "▼ show details"}
            </button>
            {showLogs && (
              <div style={{ marginTop: 8, background: "#0a0a0a", borderRadius: 8, padding: "12px 14px", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#555", maxHeight: 200, overflowY: "auto" }}>
                {logs.map((l, i) => <div key={i}>› {l}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Match Simulator */}
      <MatchSimulator onLoad={handleSimLoad} />

      <a href="https://www.team8626.com" target="_blank" rel="noopener noreferrer"
        style={{ marginTop: 32, fontSize: 11, color: "#2a2a2a", fontFamily: "'DM Mono', monospace", letterSpacing: 1, textDecoration: "none" }}
        onMouseEnter={e => e.target.style.color = ACCENT}
        onMouseLeave={e => e.target.style.color = "#2a2a2a"}>
        CYBER SAILORS · FRC 8626 · AUTO CALCULATOR
      </a>
    </div>
  );
}