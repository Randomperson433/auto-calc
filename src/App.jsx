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

// ── Outer chamfer box — angular outer border only ─────────────────────────────
function ChamferBox({ c = 14, borderColor = ACCENT + "88", borderWidth = 2, bg = "rgba(255,255,255,0.03)", style = {}, children }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = (el) => {
    if (el) {
      const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
      ro.observe(el);
    }
  };
  const { w, h } = size;
  const pts = w && h
    ? `${c},0 ${w - c},0 ${w},${c} ${w},${h - c} ${w - c},${h} ${c},${h} 0,${h - c} 0,${c}`
    : null;

  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      {pts && (
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
          <polygon points={pts} fill={bg} />
          <polygon points={pts} fill="none" stroke={borderColor} strokeWidth={borderWidth} />
        </svg>
      )}
      <div style={{ position: "relative", zIndex: 1, padding: "32px 28px" }}>
        {children}
      </div>
    </div>
  );
}

// ── Rounded input ─────────────────────────────────────────────────────────────
function ChamferInput({ value, onChange, onEnter, placeholder, color }) {
  const borderColor = color === "red" ? "#ff4d4d" : "#4d7fff";
  const borderFaint = color === "red" ? "#ff4d4d44" : "#4d7fff44";
  const [focused, setFocused] = useState(false);
  const bc = focused ? borderColor : borderFaint;

  return (
    <div style={{ position: "relative", width: "100%", marginBottom: 8 }}>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 5))}
        onKeyDown={e => e.key === "Enter" && onEnter?.()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        maxLength={5}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${bc}`,
          borderRadius: 8,
          outline: "none",
          color: "#fff",
          fontSize: 18,
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 500,
          padding: "10px 14px",
          width: "100%",
          boxSizing: "border-box",
          transition: "border-color 0.2s",
        }}
      />
    </div>
  );
}

// ── Rounded button ─────────────────────────────────────────────────────────────
function ChamferButton({ onClick, disabled, children }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: "100%",
        marginTop: 4,
        padding: "13px 0",
        border: disabled ? "1px solid #333" : `1px solid ${ACCENT}`,
        borderRadius: 8,
        background: disabled
          ? "#1a1a1a"
          : `linear-gradient(135deg, ${ACCENT_DARK}, ${ACCENT})`,
        color: disabled ? "#333" : "#1a0a1a",
        fontFamily: "'DM Mono', monospace",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 2,
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        transition: "opacity 0.2s",
      }}
    >
      {children}
    </button>
  );
}

// ── Rounded select ─────────────────────────────────────────────────────────────
function ChamferSelect({ value, onChange, children, disabled }) {
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{
          background: "#0f0f16",
          border: `1px solid ${ACCENT_GLOW}`,
          borderRadius: 8,
          outline: "none",
          color: "#fff",
          fontSize: 14,
          fontFamily: "'DM Sans', sans-serif",
          padding: "10px 14px",
          width: "100%",
          cursor: disabled ? "not-allowed" : "pointer",
          appearance: "none",
          WebkitAppearance: "none",
          boxSizing: "border-box",
        }}
      >
        {children}
      </select>
      {/* Chevron */}
      <div style={{
        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
        pointerEvents: "none", color: "#666", fontSize: 10,
      }}>▼</div>
    </div>
  );
}

// ── Rounded event key input ───────────────────────────────────────────────────
function ChamferEventInput({ value, onChange, onEnter, placeholder }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="text"
      value={value}
      onChange={onChange}
      onKeyDown={e => e.key === "Enter" && onEnter?.()}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${focused ? ACCENT : ACCENT_GLOW}`,
        borderRadius: 8,
        outline: "none",
        color: "#fff",
        fontSize: 15,
        fontFamily: "'DM Sans', sans-serif",
        padding: "10px 14px",
        width: "100%",
        boxSizing: "border-box",
        transition: "border-color 0.2s",
      }}
    />
  );
}

// ── Probability bar — outer SVG chamfer, inner bar rounded ────────────────────
function ProbBar({ pRed, pBlue }) {
  const targetR = pRed * 100;
  const targetB = pBlue * 100;
  const [dispR, setDispR] = useState(50);
  const [dispB, setDispB] = useState(50);

  useEffect(() => {
    setDispR(50); setDispB(50);
    let start = null;
    const duration = 900;
    const ease = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    function step(ts) {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const e = ease(p);
      setDispR(50 + (targetR - 50) * e);
      setDispB(50 + (targetB - 50) * e);
      if (p < 1) requestAnimationFrame(step);
    }
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [pRed, pBlue]);

  const [size, setSize] = useState({ w: 0 });
  const barRef = (el) => {
    if (el) {
      const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width }));
      ro.observe(el);
    }
  };
  const { w } = size;
  const h = 36;
  const r = 8; // corner radius for outer SVG shape
  const c = 7; // chamfer size for the SVG clip

  // Outer path: chamfered polygon for the border
  const pts = w ? `${c},0 ${w - c},0 ${w},${c} ${w},${h - c} ${w - c},${h} ${c},${h} 0,${h - c} 0,${c}` : null;
  const rW = w * (dispR / 100);
  const bW = w * (dispB / 100);

  return (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div ref={barRef} style={{ height: h, position: "relative" }}>
        {w > 0 && (
          <svg width={w} height={h} style={{ display: "block" }}>
            <defs>
              <linearGradient id="red-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#c23232" />
                <stop offset="100%" stopColor="#ff4d4d" />
              </linearGradient>
              <linearGradient id="blue-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#2244cc" />
                <stop offset="100%" stopColor="#4d7fff" />
              </linearGradient>
              {/* Chamfered clip for inner bars */}
              <clipPath id="bar-clip">
                <polygon points={pts} />
              </clipPath>
            </defs>
            {/* Background */}
            <polygon points={pts} fill="#0a0a0f" />
            {/* Colored bars, clipped to chamfer shape */}
            <g clipPath="url(#bar-clip)">
              <rect x={0} y={0} width={rW} height={h} fill="url(#red-grad)" />
              <rect x={rW} y={0} width={bW} height={h} fill="url(#blue-grad)" />
            </g>
            {/* Chamfered outer border */}
            <polygon
              points={pts}
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={1.5}
            />
            {rW > 60 && (
              <text x={rW / 2} y={h / 2 + 5} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700} fontFamily="DM Mono, monospace">
                {dispR.toFixed(1)}%
              </text>
            )}
            {bW > 60 && (
              <text x={rW + bW / 2} y={h / 2 + 5} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700} fontFamily="DM Mono, monospace">
                {dispB.toFixed(1)}%
              </text>
            )}
          </svg>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
        <span style={{ color: "#ff6b6b" }}>RED {targetR.toFixed(1)}%</span>
        <span style={{ color: "#6b9fff" }}>BLUE {targetB.toFixed(1)}%</span>
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

  useEffect(() => {
    setEvents([]); setSelectedEvent("");
    setMatches([]); setSelectedMatch("");
    setLoadingEvents(true);
    const allPromise = fetchJSON(`${TBA_BASE}/events/${year}/simple`, TBA_H).catch(() => []);
    const districtPromise = selectedDistrict !== "__all__"
      ? fetchJSON(`${TBA_BASE}/district/${selectedDistrict}/events/simple`, TBA_H).catch(() => [])
      : Promise.resolve(null);
    const DISTRICT_STATES = {
      ne: ["MA","ME","NH","VT","RI","CT"], chs: ["VA","MD","DC"], fim: ["MI"],
      fit: ["TX"], fnc: ["NC"], fma: ["NJ","PA","DE"], fin: ["IN"], isr: ["IL"],
      pnw: ["OR","WA"], pch: ["GA","AL"], cal: ["CA"], ont: ["ON"],
    };
    Promise.all([allPromise, districtPromise]).then(([all, districtEvents]) => {
      let filtered;
      if (selectedDistrict === "__all__") {
        filtered = all;
      } else {
        const districtKeys = new Set((districtEvents || []).map(e => e.key));
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

  const labelStyle = {
    fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase",
    fontFamily: "'DM Mono', monospace", display: "block", marginBottom: 6,
  };

  return (
    <div style={{ width: "100%", maxWidth: 680, marginTop: 20 }}>
      <ChamferBox c={14} borderColor={ACCENT + "88"} borderWidth={2} bg="rgba(255,255,255,0.03)" style={{ width: "100%" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: ACCENT, textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 20 }}>
          Match Simulator
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Year</label>
            <ChamferSelect value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </ChamferSelect>
          </div>
          <div>
            <label style={labelStyle}>District {loadingDistricts && <span style={{ color: "#555" }}>loading...</span>}</label>
            <ChamferSelect value={selectedDistrict} onChange={e => setSelectedDistrict(e.target.value)}>
              <option value="__all__">All Events</option>
              {districts.map(d => <option key={d.key} value={d.key}>{d.display_name}</option>)}
            </ChamferSelect>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Event {loadingEvents && <span style={{ color: "#555" }}>loading...</span>}</label>
          <ChamferSelect value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}>
            <option value="">— select an event —</option>
            {events.map(e => <option key={e.key} value={e.key}>{e.displayName || e.name}</option>)}
          </ChamferSelect>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Match {loadingMatches && <span style={{ color: "#555" }}>loading...</span>}</label>
          <ChamferSelect value={selectedMatch} onChange={e => setSelectedMatch(e.target.value)} disabled={!matches.length}>
            <option value="">— select a match —</option>
            {matches.map(m => <option key={m.key} value={m.key}>{matchLabel(m)}</option>)}
          </ChamferSelect>
        </div>

        {selectedMatchData && (() => {
          const bd = selectedMatchData.score_breakdown;
          const autoRed = bd?.red?.autoPoints ?? bd?.red?.totalAutoPoints ?? null;
          const autoBlue = bd?.blue?.autoPoints ?? bd?.blue?.totalAutoPoints ?? null;
          const autoWinner = autoRed != null && autoBlue != null
            ? (autoRed > autoBlue ? "red" : autoBlue > autoRed ? "blue" : "tie") : null;
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
                    borderRadius: 10,
                    padding: "12px 16px",
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
          <div style={{ marginBottom: 16, fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#444", display: "flex", gap: 20 }}>
            <span>Event key: <span style={{ color: "#666" }}>{selectedEvent}</span></span>
            <span>Match key: <span style={{ color: "#666" }}>{selectedMatch}</span></span>
          </div>
        )}

        <ChamferButton onClick={handleLoad} disabled={!selectedMatchData}>
          Load Teams into Calculator
        </ChamferButton>
      </ChamferBox>
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

  function handleSimLoad({ red: r, blue: b, eventKey }) {
    setRed(r); setBlue(b); setEvent(eventKey);
    setResult(null); setError(null); setLogs([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const labelStyle = {
    fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase",
    fontFamily: "'DM Mono', monospace", display: "block", marginBottom: 8,
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0f",
      fontFamily: "'DM Sans', sans-serif", color: "#fff",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "40px 20px 60px",
    }}>
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
        <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(42px, 8vw, 72px)", letterSpacing: 3, margin: 0, lineHeight: 1, color: "#fff" }}>
          AUTO WIN CALC
        </h1>
        <div style={{ fontSize: 13, color: "#555", marginTop: 8, letterSpacing: 1 }}>Auto period win probability · powered by Statbotics + TBA</div>
      </div>

      {/* Main card */}
      <div style={{ width: "100%", maxWidth: 680 }}>
        <ChamferBox c={14} borderColor={ACCENT + "88"} borderWidth={2} bg="rgba(255,255,255,0.03)" style={{ width: "100%" }}>

          {/* Event key */}
          <div style={{ marginBottom: 28 }}>
            <label style={labelStyle}>
              Event Key <span style={{ color: "#444" }}>(optional — e.g. 2026nebb)</span>
            </label>
            <ChamferEventInput
              value={event}
              onChange={e => setEvent(e.target.value)}
              onEnter={compute}
              placeholder="leave blank for full season data"
            />
          </div>

          {/* Alliance inputs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, color: "#ff6b6b", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff4d4d" }} /> Red Alliance
              </div>
              {red.map((v, i) => <ChamferInput key={i} value={v} onChange={val => updateRed(i, val)} onEnter={compute} placeholder={`Team ${i + 1}`} color="red" />)}
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, color: "#6b9fff", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4d7fff" }} /> Blue Alliance
              </div>
              {blue.map((v, i) => <ChamferInput key={i} value={v} onChange={val => updateBlue(i, val)} onEnter={compute} placeholder={`Team ${i + 1}`} color="blue" />)}
            </div>
          </div>

          <ChamferButton onClick={compute} disabled={!canCompute || loading}>
            {loading ? "Computing..." : "Calculate Auto Win Prob"}
          </ChamferButton>

          {loading && logs.length > 0 && (
            <div style={{
              marginTop: 16, background: "#0a0a0a", padding: "12px 14px",
              fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#666",
              maxHeight: 120, overflowY: "auto", borderRadius: 6,
              border: "1px solid #1a1a1a",
            }}>
              {logs.map((l, i) => <div key={i} style={{ color: i === logs.length - 1 ? ACCENT : "#555" }}>› {l}</div>)}
            </div>
          )}

          {error && (
            <div style={{
              marginTop: 16, padding: "12px 16px",
              background: "#ff4d4d11", border: "1px solid #ff4d4d33",
              borderRadius: 8, color: "#ff8080", fontSize: 13,
              fontFamily: "'DM Mono', monospace",
            }}>
              {error}
            </div>
          )}

          {result && !loading && (
            <div style={{ marginTop: 24 }}>
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 24 }} />
              <div style={{ fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 16 }}>Auto Period Result</div>
              <ProbBar pRed={result.pRed} pBlue={result.pBlue} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
                {[
                  { label: "Red Auto Win", pct: result.pRed, total: result.redTotal, color: "#ff4d4d" },
                  { label: "Blue Auto Win", pct: result.pBlue, total: result.blueTotal, color: "#4d7fff" },
                ].map(({ label, pct, total, color }) => (
                  <div key={label} style={{
                    background: `${color}08`,
                    border: `1px solid ${color}22`,
                    borderRadius: 10,
                    padding: "16px 20px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 10, color: "#666", fontFamily: "'DM Mono', monospace", marginBottom: 6, whiteSpace: "nowrap" }}>{label}</div>
                    <div style={{ fontSize: 36, fontFamily: "'Bebas Neue', sans-serif", color, letterSpacing: 2, lineHeight: 1 }}>{(pct * 100).toFixed(1)}%</div>
                    <div style={{ fontSize: 11, color: "#555", fontFamily: "'DM Mono', monospace", marginTop: 6 }}>EPA: {total.toFixed(2)} pts</div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowLogs(s => !s)}
                style={{
                  marginTop: 16, background: "none", border: "none",
                  color: "#444", fontSize: 11, fontFamily: "'DM Mono', monospace",
                  cursor: "pointer", letterSpacing: 1,
                }}
              >
                {showLogs ? "▲ hide details" : "▼ show details"}
              </button>
              {showLogs && (
                <div style={{
                  marginTop: 8, background: "#0a0a0a", padding: "12px 14px",
                  fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#555",
                  maxHeight: 200, overflowY: "auto", borderRadius: 6,
                  border: "1px solid #1a1a1a",
                }}>
                  {logs.map((l, i) => <div key={i}>› {l}</div>)}
                </div>
              )}
            </div>
          )}
        </ChamferBox>
      </div>

      <MatchSimulator onLoad={handleSimLoad} />

      <a
        href="https://www.team8626.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{ marginTop: 32, fontSize: 11, color: "#2a2a2a", fontFamily: "'DM Mono', monospace", letterSpacing: 1, textDecoration: "none" }}
        onMouseEnter={e => e.target.style.color = ACCENT}
        onMouseLeave={e => e.target.style.color = "#2a2a2a"}
      >
        CYBER SAILORS · FRC 8626 · AUTO CALCULATOR
      </a>
    </div>
  );
}