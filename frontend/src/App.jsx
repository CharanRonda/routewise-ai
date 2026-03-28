import { useEffect, useRef, useState } from "react";

import {
  askAssistant,
  endSimulation,
  fetchDashboard,
  fetchSnapshot,
  startSimulation,
  updateConditions,
} from "./api";
import { generateReportPdf } from "./report";

const initialForm = {
  scenario_name: "NH-44 monsoon reroute",
  origin: "Chennai",
  destination: "Delhi",
  cargo_tons: 10,
  priority: "balanced",
  is_international: false,
};

const steps = [
  "GEOCODING CORRIDOR",
  "CHECKING DISRUPTION INPUTS",
  "GENERATING ROUTE OPTIONS",
  "SCORING ETA / COST / CO2",
  "RUNNING CUSTOMS + GREEN ANALYSIS",
  "PUBLISHING RECOMMENDATION",
];

const quickQuestions = [
  "What if delay increases to 12h?",
  "Compare sea vs air route cost",
  "Which route has the lowest carbon?",
  "What if fuel prices rise 25%?",
  "How much customs time is included?",
];

function createMessage(role, text, overrides = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    role,
    text,
    ...overrides,
  };
}

function buildInitialMessages() {
  return [
    createMessage(
      "ai",
      "Decision engine online. Enter a corridor, launch analysis, and inspect ranked route options across ETA, cost, customs, and carbon impact.",
      {
        engineLabel: "ROUTEWISE ENGINE",
        statusNote: "Start a live corridor to ask scenario-aware questions.",
      },
    ),
  ];
}

const cityCoordinates = {
  chennai: { lat: 13.0827, lng: 80.2707 },
  delhi: { lat: 28.6139, lng: 77.209 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  dubai: { lat: 25.2048, lng: 55.2708 },
  pune: { lat: 18.5204, lng: 73.8567 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
  shanghai: { lat: 31.2304, lng: 121.4737 },
  hamburg: { lat: 53.5511, lng: 9.9937 },
  muscat: { lat: 23.588, lng: 58.3829 },
  singapore: { lat: 1.3521, lng: 103.8198 },
  colombo: { lat: 6.9271, lng: 79.8612 },
  suez: { lat: 29.9668, lng: 32.5498 },
  gibraltar: { lat: 36.1408, lng: -5.3536 },
  "nhava sheva": { lat: 18.95, lng: 72.95 },
};

const modeMeta = {
  road: { label: "ROAD", color: "#F5A623", icon: "TR" },
  rail: { label: "RAIL", color: "#38BDF8", icon: "RL" },
  sea: { label: "SEA", color: "#06B6D4", icon: "SEA" },
  air: { label: "AIR", color: "#A78BFA", icon: "AIR" },
  multimodal: { label: "MULTI", color: "#F472B6", icon: "MX" },
};

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function scoreColor(score) {
  if (score >= 80) return "var(--amber)";
  if (score >= 60) return "var(--blue)";
  return "var(--red)";
}

function riskColor(label) {
  if (!label) return "var(--green)";
  if (label.toLowerCase().includes("high")) return "var(--red)";
  if (label.toLowerCase().includes("watch")) return "var(--amber)";
  return "var(--green)";
}

function recommendationClass(recommendation) {
  if (!recommendation) return "pill-live";
  if (recommendation.cls === "reroute") return "pill-risk";
  if (recommendation.cls === "review") return "pill-watch";
  return "pill-live";
}

function priorityLabel(priority) {
  if (!priority) return "Balanced";
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function routeMode(route) {
  const text = `${route.title} ${route.mode}`.toLowerCase();
  const hasRoad = text.includes("truck") || text.includes("road");
  const hasRail = text.includes("rail");
  const hasSea = text.includes("sea");

  if (text.includes("air")) return "air";
  if ((hasRoad && hasRail) || (hasRoad && hasSea) || text.includes("multimodal")) {
    return "multimodal";
  }
  if (hasSea) return "sea";
  if (hasRail) return "rail";
  return "road";
}

function resolveCoords(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const direct = cityCoordinates[lower];
  if (direct) return direct;

  const match = Object.entries(cityCoordinates).find(([key]) => lower.includes(key));
  return match ? match[1] : null;
}

function haversineKm(start, end) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earth = 6371;
  const latDiff = toRad(end.lat - start.lat);
  const lngDiff = toRad(end.lng - start.lng);
  const a =
    Math.sin(latDiff / 2) ** 2 +
    Math.cos(toRad(start.lat)) *
      Math.cos(toRad(end.lat)) *
      Math.sin(lngDiff / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function interpolatePath(start, end, segments, arcHeight = 0) {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments;
    const lat =
      start.lat + (end.lat - start.lat) * t + Math.sin(Math.PI * t) * arcHeight;
    const lng = start.lng + (end.lng - start.lng) * t;
    return [lat, lng];
  });
}

function buildRoutePath(start, end, route, isInternational) {
  const mode = routeMode(route);
  const latSpan = Math.abs(end.lat - start.lat);

  if (mode === "air") {
    return interpolatePath(start, end, 6, Math.max(6, latSpan * 0.35));
  }

  if (mode === "sea" || (mode === "multimodal" && isInternational)) {
    const lowerPair = `${start.lat},${start.lng}:${end.lat},${end.lng}`;
    if (lowerPair.includes("19.076") || lowerPair.includes("72.8777")) {
      return [
        [start.lat, start.lng],
        [20.8, 69.6],
        [22.4, 63.8],
        [24.1, 59.4],
        [end.lat, end.lng],
      ];
    }

    if (start.lng > 90 && end.lng < 20) {
      return [
        [start.lat, start.lng],
        [1.35, 103.82],
        [6.92, 79.86],
        [29.97, 32.55],
        [36.14, -5.35],
        [end.lat, end.lng],
      ];
    }

    return interpolatePath(start, end, 6, Math.max(4, latSpan * 0.18));
  }

  if (mode === "rail" || mode === "multimodal") {
    return interpolatePath(start, end, 5, Math.max(2.5, latSpan * 0.12));
  }

  return interpolatePath(start, end, 5, Math.max(1.2, latSpan * 0.08));
}

function inverseScore(value, collection) {
  const minimum = Math.min(...collection);
  const maximum = Math.max(...collection);
  if (maximum === minimum) return 100;
  return clamp(((maximum - value) / (maximum - minimum)) * 100);
}

function deriveSignals(snapshot, route) {
  if (!snapshot || !route) {
    return {
      eta_reliability: 0,
      cost_efficiency: 0,
      carbon_efficiency: 0,
      disruption_resilience: 0,
      customs_readiness: 0,
    };
  }

  if (route.code === snapshot.selected_route_code) {
    return snapshot.signals;
  }

  const etaValues = snapshot.routes.map((item) => item.eta_hours);
  const costValues = snapshot.routes.map((item) => item.cost_inr);
  const carbonValues = snapshot.routes.map((item) => item.co2_kg);

  const disruptionPenalty =
    snapshot.disruption.weather_index * 0.28 +
    snapshot.disruption.congestion_index * 0.34 +
    snapshot.disruption.fuel_delta_percent * 0.9;
  const riskAdjustment =
    route.risk_label === "High Risk" ? 28 : route.risk_label === "Watch" ? 14 : 0;

  return {
    eta_reliability: inverseScore(route.eta_hours, etaValues),
    cost_efficiency: inverseScore(route.cost_inr, costValues),
    carbon_efficiency: inverseScore(route.co2_kg, carbonValues),
    disruption_resilience: clamp(92 - disruptionPenalty - riskAdjustment),
    customs_readiness: snapshot.disruption.is_international
      ? clamp(96 - route.customs_hours * 3.2)
      : 96,
  };
}

function delayRisk(snapshot) {
  if (!snapshot) return { label: "LOW", color: "var(--green)" };
  const value =
    snapshot.disruption.weather_index * 0.35 +
    snapshot.disruption.congestion_index * 0.35 +
    snapshot.disruption.customs_delay_hours * 2 +
    snapshot.disruption.fuel_delta_percent * 0.8;

  if (value >= 70) return { label: "HIGH", color: "var(--red)" };
  if (value >= 45) return { label: "MED", color: "var(--amber)" };
  return { label: "LOW", color: "var(--green)" };
}

function routeDistance(snapshot, route) {
  const start = resolveCoords(snapshot?.origin);
  const end = resolveCoords(snapshot?.destination);
  if (!start || !end) return null;

  const base = haversineKm(start, end);
  const mode = routeMode(route);
  if (mode === "air") return Math.round(base * 1.05);
  if (mode === "sea") return Math.round(base * 1.42);
  if (mode === "multimodal") return Math.round(base * 1.18);
  if (mode === "rail") return Math.round(base * 1.1);
  return Math.round(base * 1.08);
}

function routeSummary(snapshot, route) {
  if (!snapshot || !route) return "";

  const recommended = snapshot.selected_route;
  const timeDelta = route.eta_hours - recommended.eta_hours;
  const costDelta = route.cost_inr - recommended.cost_inr;
  const carbonDelta = route.co2_kg - recommended.co2_kg;

  const timeCopy =
    timeDelta === 0 ? "matching the current ETA" : timeDelta < 0 ? `${Math.abs(timeDelta)}h faster` : `${timeDelta}h slower`;
  const costCopy =
    costDelta === 0
      ? "priced at the same level"
      : costDelta < 0
        ? `${formatCurrency(Math.abs(costDelta))} cheaper`
        : `${formatCurrency(costDelta)} more expensive`;
  const carbonCopy =
    carbonDelta === 0
      ? "with the same carbon load"
      : carbonDelta < 0
        ? `${formatNumber(Math.abs(carbonDelta))} kg less CO2`
        : `${formatNumber(carbonDelta)} kg more CO2`;

  return `${route.title} is ${timeCopy}, ${costCopy}, and runs ${carbonCopy} than the current recommended lane.`;
}

function fuelResilience(route) {
  const mode = routeMode(route);
  if (mode === "sea") return 3;
  if (mode === "multimodal") return 2;
  if (mode === "rail") return 2;
  if (mode === "air") return 5;
  return 4;
}

function StepList({ activeIndex, completed, visible }) {
  if (!visible) return null;

  return (
    <div className="slist">
      {steps.map((label, index) => {
        const done = completed || index < activeIndex;
        const active = !completed && index === activeIndex;
        return (
          <div
            className={`sitem ${done ? "done" : ""} ${active ? "act" : ""}`}
            key={label}
          >
            <div className="sdot">{done ? "✓" : index + 1}</div>
            <div className="slbl">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function SignalPanel({ signals }) {
  const rows = [
    ["ETA reliability", signals.eta_reliability],
    ["Cost efficiency", signals.cost_efficiency],
    ["Carbon efficiency", signals.carbon_efficiency],
    ["Disruption resilience", signals.disruption_resilience],
    ["Customs readiness", signals.customs_readiness],
  ];

  return (
    <div className="signal-stack">
      {rows.map(([label, value]) => (
        <div className="signal-item" key={label}>
          <div className="signal-label-row">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
          <div className="signal-bar-bg">
            <div
              className="signal-bar"
              style={{ width: `${value}%`, background: scoreColor(value) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RouteCard({ route, snapshot, selected, onSelect }) {
  const meta = modeMeta[routeMode(route)];
  const distance = snapshot ? routeDistance(snapshot, route) : null;
  const carbonValues = snapshot?.routes?.map((item) => item.co2_kg) || [route.co2_kg];
  const carbonPct = Math.max(
    14,
    (route.co2_kg / Math.max(...carbonValues, 1)) * 100,
  );

  return (
    <button
      className={`rcard ${selected ? "sel" : ""}`}
      type="button"
      onClick={() => onSelect(route.code)}
    >
      <div className="rheader">
        <div>
          <span className="rbadge" style={{ color: meta.color, background: `${meta.color}18` }}>
            {route.badges[0] || "OPTION"}
          </span>
          <div className="rtitle">
            {meta.icon} Route {route.code} — {route.title}
          </div>
        </div>
        <div className="rscore" style={{ color: scoreColor(route.score) }}>
          {route.score}
        </div>
      </div>

      <div className="rmetrics">
        <div className="rmet">
          <div className="rmet-l">TIME</div>
          <div className="rmet-v">{route.eta_hours}h</div>
          <div className="rmet-s">{route.customs_hours}h customs</div>
        </div>
        <div className="rmet">
          <div className="rmet-l">COST</div>
          <div className="rmet-v">{formatCurrency(route.cost_inr)}</div>
          <div className="rmet-s">{distance ? `${formatNumber(distance)} km` : route.mode}</div>
        </div>
        <div className="rmet">
          <div className="rmet-l">CO2</div>
          <div className="rmet-v" style={{ color: route.co2_kg === Math.min(...carbonValues) ? "var(--green)" : "var(--text)" }}>
            {formatNumber(route.co2_kg)} kg
          </div>
          <div className="rmet-s">{route.mode}</div>
        </div>
      </div>

      <div className="rrisk">
        <div className="rdot" style={{ background: riskColor(route.risk_label) }} />
        <div className="rrisk-t">{route.risk_label} · {route.summary}</div>
      </div>
      <div className="rbar-bg">
        <div
          className="rbar"
          style={{ width: `${carbonPct}%`, background: route.co2_kg === Math.min(...carbonValues) ? "var(--green)" : "var(--amber)" }}
        />
      </div>
      <div>
        <span className="rmode" style={{ color: meta.color, background: `${meta.color}15`, borderColor: `${meta.color}30` }}>
          {meta.icon} {meta.label}
        </span>
      </div>
    </button>
  );
}

function ArchiveCard({ scenario }) {
  return (
    <div className="rcard archive-card">
      <div className="rheader">
        <div>
          <span className="rbadge" style={{ color: "#94A3B8", background: "#94A3B815" }}>
            ARCHIVE
          </span>
          <div className="rtitle">{scenario.name}</div>
        </div>
        <div className="rscore" style={{ color: scoreColor(scenario.score) }}>
          {scenario.score}
        </div>
      </div>
      <div className="rmetrics archive-metrics">
        <div className="rmet">
          <div className="rmet-l">LANE</div>
          <div className="rmet-v">{scenario.corridor}</div>
        </div>
        <div className="rmet">
          <div className="rmet-l">ETA</div>
          <div className="rmet-v">{scenario.eta_hours}h</div>
        </div>
      </div>
      <div className="rrisk">
        <div className="rdot" style={{ background: scoreColor(scenario.score) }} />
        <div className="rrisk-t">{scenario.recommended_route}</div>
      </div>
    </div>
  );
}

function RouteMap({ snapshot, activeRouteCode, onRouteSelect }) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [hoveredCode, setHoveredCode] = useState("");

  const activeRoute =
    snapshot?.routes?.find((route) => route.code === hoveredCode) ||
    snapshot?.routes?.find((route) => route.code === activeRouteCode) ||
    null;

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current || !window.L) return undefined;

    const leaflet = window.L;
    const map = leaflet.map(mapElementRef.current, {
      zoomControl: false,
      attributionControl: true,
    });

    leaflet.control.zoom({ position: "topright" }).addTo(map);
    leaflet
      .tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "©OpenStreetMap ©CartoDB",
        subdomains: "abcd",
        maxZoom: 19,
      })
      .addTo(map);

    map.setView([20, 15], 2);
    mapRef.current = map;
    layerRef.current = leaflet.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current || !window.L) return undefined;

    const leaflet = window.L;
    const map = mapRef.current;
    const layerGroup = layerRef.current;
    layerGroup.clearLayers();

    if (!snapshot) {
      map.setView([20, 15], 2);
      return undefined;
    }

    const source = resolveCoords(snapshot.origin);
    const destination = resolveCoords(snapshot.destination);
    if (!source || !destination) {
      map.setView([20, 15], 2);
      return undefined;
    }

    const points = [];
    const lineLayers = [];

    snapshot.routes.forEach((route) => {
      const meta = modeMeta[routeMode(route)];
      const path = buildRoutePath(source, destination, route, snapshot.disruption.is_international);
      path.forEach((point) => points.push(point));

      const line = leaflet
        .polyline(path, {
          color: meta.color,
          weight: route.code === activeRouteCode ? 3.4 : 1.8,
          opacity: route.code === activeRouteCode ? 1 : 0.34,
          dashArray: routeMode(route) === "sea" ? "10,7" : routeMode(route) === "air" ? "4,7" : null,
          lineCap: "round",
        })
        .addTo(layerGroup);

      line.on("mouseover", () => setHoveredCode(route.code));
      line.on("mouseout", () => setHoveredCode(""));
      line.on("click", () => onRouteSelect(route.code));

      lineLayers.push(line);
    });

    leaflet
      .circleMarker([source.lat, source.lng], {
        radius: 6,
        weight: 2,
        color: "#ffffff",
        fillColor: "#F5A623",
        fillOpacity: 1,
      })
      .bindTooltip(snapshot.origin)
      .addTo(layerGroup);

    leaflet
      .circleMarker([destination.lat, destination.lng], {
        radius: 6,
        weight: 2,
        color: "#ffffff",
        fillColor: "#EF4444",
        fillOpacity: 1,
      })
      .bindTooltip(snapshot.destination)
      .addTo(layerGroup);

    map.fitBounds(points, { padding: [50, 50] });
    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      lineLayers.forEach((line) => {
        line.off();
      });
    };
  }, [snapshot, activeRouteCode, onRouteSelect]);

  const activeDistance = snapshot && activeRoute ? routeDistance(snapshot, activeRoute) : null;

  return (
    <div id="mapbox">
      <div id="map" ref={mapElementRef} />

      <div className="map-overlay" id="map-legend">
        <div className="leg-title">TRANSPORT MODE</div>
        {Object.values(modeMeta).map((meta) => (
          <div className="leg-row" key={meta.label}>
            <div className="leg-ln" style={{ background: meta.color }} />
            {meta.label}
          </div>
        ))}
      </div>

      {snapshot && activeRoute ? (
        <div className="map-overlay" id="map-info">
          <div className="info-route">
            {modeMeta[routeMode(activeRoute)].icon} Route {activeRoute.code} — {modeMeta[routeMode(activeRoute)].label}
          </div>
          <div className="info-name">{activeRoute.title}</div>
          <div className="info-row">
            <span>TIME</span>
            <span>{activeRoute.eta_hours}h</span>
          </div>
          <div className="info-row">
            <span>COST</span>
            <span>{formatCurrency(activeRoute.cost_inr)}</span>
          </div>
          <div className="info-row">
            <span>CO2</span>
            <span>{formatNumber(activeRoute.co2_kg)} kg</span>
          </div>
          <div className="info-row">
            <span>DIST</span>
            <span>{activeDistance ? `${formatNumber(activeDistance)} km` : "—"}</span>
          </div>
        </div>
      ) : null}

      {!snapshot ? (
        <div id="idle">
          <div className="idle-mark">◈</div>
          <div className="idle-txt">Global route analysis ready</div>
          <div className="idle-sub">ANY ORIGIN {"->"} ANY DESTINATION</div>
        </div>
      ) : null}
    </div>
  );
}

function ChatPanel({
  snapshot,
  activeRoute,
  messages,
  pendingInput,
  chatBusy,
  onInputChange,
  onQuickQuestion,
  onSend,
  compact = false,
}) {
  return (
    <div id="chat" className={compact ? "chat-compact" : ""}>
      <div className="chat-hdr">
        <div className="chat-dot" />
        <div className="chat-lbl">WHAT-IF ANALYSIS ENGINE</div>
      </div>

      <div id="chat-msgs">
        {messages.map((message, index) => (
          <div className={`cmsg ${message.role}`} key={message.id || `${message.role}-${index}`}>
            <div className={`cbub ${message.role}`}>
              {message.role === "ai" ? (
                <span className="ailbl">{message.engineLabel || "ROUTEWISE ENGINE"} ▸</span>
              ) : null}
              {message.text}
              {message.role === "ai" && message.statusNote ? (
                <div className="msg-meta">{message.statusNote}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="chips">
        {quickQuestions.map((question) => (
          <button
            className="chip"
            type="button"
            key={question}
            onClick={() => onQuickQuestion(question)}
            disabled={chatBusy}
          >
            {question}
          </button>
        ))}
      </div>

      <div className="cinput-row">
        <input
          id="cinput"
          value={pendingInput}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSend();
            }
          }}
          disabled={chatBusy}
          placeholder={
            chatBusy
              ? "Analyzing live scenario..."
              : snapshot && activeRoute
              ? `Ask about ${activeRoute.title}...`
              : "Ask any what-if question..."
          }
        />
        <button id="csend" type="button" onClick={onSend} disabled={chatBusy}>
          {chatBusy ? "ANALYZING..." : "▶ SEND"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  const [form, setForm] = useState(initialForm);
  const [simulationId, setSimulationId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [simulationError, setSimulationError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [analysisStep, setAnalysisStep] = useState(-1);
  const [activeRouteCode, setActiveRouteCode] = useState("");
  const [messages, setMessages] = useState(buildInitialMessages);
  const [pendingInput, setPendingInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const [showReport, setShowReport] = useState(false);
  const [finalReport, setFinalReport] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadDashboardData() {
      setLoading(true);
      setDashboardError("");

      try {
        const data = await fetchDashboard();
        if (!active) return;
        setDashboard(data);
      } catch (error) {
        console.error(error);
        if (active) setDashboardError("Unable to load dashboard data right now.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDashboardData();

    return () => {
      active = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!running || !simulationId) return undefined;

    const intervalId = window.setInterval(async () => {
      try {
        const nextSnapshot = await fetchSnapshot(simulationId);
        setSnapshot(nextSnapshot);
      } catch (error) {
        console.error(error);
        setSimulationError("Live refresh failed. Showing the latest data we have.");
      }
    }, 2500);

    return () => window.clearInterval(intervalId);
  }, [running, simulationId]);

  useEffect(() => {
    if (!snapshot) return;
    setActiveRouteCode((current) =>
      snapshot.routes.some((route) => route.code === current)
        ? current
        : snapshot.selected_route_code,
    );
  }, [snapshot]);

  useEffect(() => {
    if (!simulationId || !snapshot) return;
    setMessages([
      ...buildInitialMessages(),
      createMessage(
        "ai",
        `Analysis complete. ${snapshot.selected_route.title} is currently leading for ${snapshot.corridor} with score ${snapshot.recommendation_score}. ${snapshot.llm_brief}`,
        {
          engineLabel: "ROUTEWISE ENGINE",
          statusNote:
            "Chat is now running through the backend assistant. Add OPENAI_API_KEY to enable live-model answers.",
        },
      ),
    ]);
  }, [simulationId, snapshot?.simulation_id]);

  const activeRoute =
    snapshot?.routes?.find((route) => route.code === activeRouteCode) ||
    snapshot?.selected_route ||
    null;
  const activeSignals = activeRoute ? deriveSignals(snapshot, activeRoute) : null;
  const risk = delayRisk(snapshot);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function applyTemplate(kind) {
    if (kind === "international") {
      setForm({
        scenario_name: "Mumbai to Dubai customs buffer",
        origin: "Mumbai",
        destination: "Dubai",
        cargo_tons: 12,
        priority: "green",
        is_international: true,
      });
      return;
    }

    setForm({
      scenario_name: "NH-44 monsoon reroute",
      origin: "Chennai",
      destination: "Delhi",
      cargo_tons: 10,
      priority: "balanced",
      is_international: false,
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setChatBusy(false);
    setSimulationError("");
    setShowReport(false);
    setFinalReport(null);
    setAnalysisStep(0);
    setPendingInput("");
    setMessages(buildInitialMessages());

    try {
      for (let index = 0; index < 3; index += 1) {
        setAnalysisStep(index);
        await wait(180);
      }

      const response = await startSimulation({
        ...form,
        cargo_tons: Number(form.cargo_tons),
      });

      for (let index = 3; index < steps.length; index += 1) {
        setAnalysisStep(index);
        await wait(150);
      }

      setSimulationId(response.simulation_id);
      setSnapshot(response.snapshot);
      setRunning(true);
    } catch (error) {
      console.error(error);
      setSimulationError("Unable to launch the live simulation.");
      setAnalysisStep(-1);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjust(field, value) {
    if (!simulationId) return;

    setSnapshot((current) =>
      current
        ? {
            ...current,
            disruption: {
              ...current.disruption,
              [field]: value,
            },
          }
        : current,
    );

    try {
      const nextSnapshot = await updateConditions(simulationId, { [field]: value });
      setSnapshot(nextSnapshot);
    } catch (error) {
      console.error(error);
      setSimulationError("Could not update the disruption input.");
    }
  }

  async function handleEnd() {
    if (!simulationId) return;

    setBusy(true);
    setSimulationError("");

    try {
      const response = await endSimulation(simulationId);
      setFinalReport(response.report);
      setShowReport(true);
      setRunning(false);
    } catch (error) {
      console.error(error);
      setSimulationError("Unable to generate the final decision report.");
    } finally {
      setBusy(false);
    }
  }

  function resetWorkspace() {
    setSimulationId("");
    setSnapshot(null);
    setRunning(false);
    setSimulationError("");
    setAnalysisStep(-1);
    setShowReport(false);
    setFinalReport(null);
    setActiveRouteCode("");
    setMessages(buildInitialMessages());
    setPendingInput("");
    setChatBusy(false);
    setRefreshKey((current) => current + 1);
  }

  async function sendQuestion(question) {
    const trimmed = question.trim();
    if (!trimmed || chatBusy) return;

    const userMessage = createMessage("user", trimmed);
    setPendingInput("");

    if (!simulationId || !snapshot) {
      setMessages((current) => [
        ...current,
        userMessage,
        createMessage(
          "ai",
          "Run a corridor analysis first so I can compare real route options.",
          {
            engineLabel: "ROUTEWISE ENGINE",
            statusNote: "No live simulation is active yet.",
          },
        ),
      ]);
      return;
    }

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setMessages((current) => [
      ...current,
      userMessage,
      createMessage("ai", "Analyzing the current scenario...", {
        id: pendingId,
        engineLabel: "ROUTEWISE ENGINE",
        statusNote: "Pulling the latest route snapshot.",
      }),
    ]);
    setChatBusy(true);
    setSimulationError("");

    try {
      const response = await askAssistant(simulationId, {
        question: trimmed,
        route_code: activeRoute?.code || null,
      });

      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? createMessage("ai", response.answer, {
                id: pendingId,
                engineLabel: response.engine_label,
                statusNote: response.status_note,
              })
            : message,
        ),
      );
    } catch (error) {
      console.error(error);
      setSimulationError("Assistant response failed. Showing the current scenario state only.");
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? createMessage(
                "ai",
                "I could not generate a scenario answer right now. Please try again.",
                {
                  id: pendingId,
                  engineLabel: "ROUTEWISE ENGINE",
                  statusNote: "Assistant request failed.",
                },
              )
            : message,
        ),
      );
    } finally {
      setChatBusy(false);
    }
  }

  const stats = snapshot
    ? [
        { label: "ROUTES", value: snapshot.routes.length, color: "var(--amber)" },
        { label: "BEST SCORE", value: snapshot.recommendation_score, color: scoreColor(snapshot.recommendation_score) },
        { label: "DELAY RISK", value: risk.label, color: risk.color },
      ]
    : [
        { label: "SCENARIOS", value: dashboard?.metrics?.total_scenarios ?? "—", color: "var(--amber)" },
        { label: "AVG SCORE", value: dashboard?.metrics?.average_score ?? "—", color: "var(--green)" },
        { label: "CUSTOMS FLAGS", value: dashboard?.metrics?.customs_flags ?? "—", color: "var(--blue)" },
      ];

  return (
    <>
      <div className="console-root">
        <header id="hdr">
          <div className="logo">
            <div className="logo-mark">◈</div>
            <div>
              <div className="logo-name">ROUTEWISE AI</div>
              <div className="logo-ver">GLOBAL DECISION LAYER v1.0</div>
            </div>
          </div>
          <div className="hdr-tags">
            <div className="hdr-tag">ROUTES</div>
            <div className="hdr-tag">RISK</div>
            <div className="hdr-tag">CARBON</div>
            <div className="hdr-tag">CUSTOMS</div>
            <div className="hdr-tag">GLOBAL</div>
          </div>
          <div className={`pill ${recommendationClass(snapshot?.recommendation)}`}>
            <div className="pill-dot" />
            <div className="pill-txt">{running ? "LIVE" : "ONLINE"}</div>
          </div>
        </header>

        <div id="wrap">
          <aside id="left">
            {dashboardError || simulationError ? (
              <div className="pane error-pane">
                <div className="plabel">▸ STATUS</div>
                <div className="error-copy">{dashboardError || simulationError}</div>
              </div>
            ) : null}

            <div id="apibox">
              <div className="plabel">▸ STACK PROFILE</div>
              <div className="apirow stack-note">
                React + FastAPI core with RouteWise logistics modeling. What-if chat now runs through a backend assistant with an OpenAI-compatible live path and a local scenario fallback.
              </div>
            </div>

            <div className="pane">
              <div className="plabel">▸ SHIPMENT CONFIGURATION</div>

              <form onSubmit={handleSubmit}>
                <div className="field">
                  <div className="flabel">SCENARIO NAME</div>
                  <div className="frow">
                    <span className="ficon">◉</span>
                    <input
                      value={form.scenario_name}
                      onChange={(event) => updateForm("scenario_name", event.target.value)}
                      placeholder="NH-44 monsoon reroute"
                    />
                  </div>
                </div>

                <div className="field">
                  <div className="flabel">SOURCE</div>
                  <div className="frow">
                    <span className="ficon" style={{ color: "var(--amber)" }}>◎</span>
                    <input
                      value={form.origin}
                      onChange={(event) => updateForm("origin", event.target.value)}
                      placeholder="Chennai"
                    />
                    <span className="fstatus">{snapshot ? "✓" : ""}</span>
                  </div>
                </div>

                <div className="field">
                  <div className="flabel">DESTINATION</div>
                  <div className="frow">
                    <span className="ficon" style={{ color: "var(--red)" }}>◎</span>
                    <input
                      value={form.destination}
                      onChange={(event) => updateForm("destination", event.target.value)}
                      placeholder="Delhi"
                    />
                    <span className="fstatus">{snapshot ? "✓" : ""}</span>
                  </div>
                </div>

                <div className="split-fields">
                  <div className="field">
                    <div className="flabel">CARGO</div>
                    <div className="frow">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={form.cargo_tons}
                        onChange={(event) => updateForm("cargo_tons", Number(event.target.value))}
                      />
                    </div>
                  </div>

                  <div className="field">
                    <div className="flabel">PRIORITY</div>
                    <div className="frow select-row">
                      <select
                        value={form.priority}
                        onChange={(event) => updateForm("priority", event.target.value)}
                      >
                        <option value="balanced">BALANCED</option>
                        <option value="speed">SPEED</option>
                        <option value="green">GREEN</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="toggle-line">
                  <label className="toggle-item">
                    <input
                      type="checkbox"
                      checked={form.is_international}
                      onChange={(event) => updateForm("is_international", event.target.checked)}
                    />
                    <span>INTERNATIONAL SHIPMENT</span>
                  </label>
                  <div className="template-actions">
                    <button type="button" className="tiny-btn" onClick={() => applyTemplate("domestic")}>
                      Chennai {"->"} Delhi
                    </button>
                    <button type="button" className="tiny-btn" onClick={() => applyTemplate("international")}>
                      Mumbai {"->"} Dubai
                    </button>
                  </div>
                </div>

                <button id="gobtn" disabled={busy || running}>
                  {busy ? "⟳ ANALYZING..." : running ? "LIVE ANALYSIS ACTIVE" : "▶ ANALYZE GLOBAL ROUTES"}
                </button>
              </form>

              {running ? (
                <button className="ghost-btn" type="button" onClick={handleEnd} disabled={busy}>
                  ■ END CURRENT SIMULATION
                </button>
              ) : null}
            </div>

            <div className="pane">
              <div className="plabel">▸ DECISION ENGINE</div>
              <StepList
                activeIndex={analysisStep}
                completed={Boolean(snapshot)}
                visible={busy || Boolean(snapshot)}
              />
              {!busy && !snapshot ? (
                <div className="placeholder-copy">
                  Start a corridor analysis to light up the scoring pipeline.
                </div>
              ) : null}
            </div>

            <div className="pane">
              <div className="plabel">▸ LIVE STATS</div>
              <div className="statsrow">
                {stats.map((stat) => (
                  <div className="sstat" key={stat.label}>
                    <div className="sstat-l">{stat.label}</div>
                    <div className="sstat-v" style={{ color: stat.color }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pane">
              <div className="plabel">▸ ACTIVE ROUTE</div>
              <div className="side-panel-card">
                <div className="strip-title">
                  {activeRoute ? activeRoute.title : "Awaiting analysis"}
                </div>
                <div className="strip-copy">
                  {activeRoute && snapshot
                    ? routeSummary(snapshot, activeRoute)
                    : "Launch a corridor to inspect route alternatives, map overlays, and recommendation shifts."}
                </div>
              </div>
            </div>

            <div className="pane">
              <div className="plabel">▸ RECOMMENDATION</div>
              <div className="side-panel-card">
                <div className={`strip-pill ${recommendationClass(snapshot?.recommendation)}`}>
                  {snapshot?.recommendation?.label || "READY"}
                </div>
                <div className="strip-copy">
                  {snapshot?.recommendation?.message ||
                    "The console is ready to rank global route options once a scenario is launched."}
                </div>
              </div>
            </div>

            <div className="pane">
              <div className="plabel">▸ PARAMETER EVALUATION</div>
              <div className="side-panel-card signal-card">
                {activeSignals ? (
                  <SignalPanel signals={activeSignals} />
                ) : (
                  <div className="placeholder-copy">
                    Signal bars appear after the first recommendation is generated.
                  </div>
                )}
              </div>
            </div>

            <div className="pane chat-pane">
              <ChatPanel
                snapshot={snapshot}
                activeRoute={activeRoute}
                messages={messages}
                pendingInput={pendingInput}
                chatBusy={chatBusy}
                onInputChange={setPendingInput}
                onQuickQuestion={sendQuestion}
                onSend={() => sendQuestion(pendingInput)}
                compact
              />
            </div>
          </aside>

          <section id="right">
            <RouteMap
              snapshot={snapshot}
              activeRouteCode={activeRouteCode}
              onRouteSelect={setActiveRouteCode}
            />

            <div className="ops-dock">
              <div className="dock-section dock-controls">
                <div className="plabel">▸ DISRUPTION INPUTS</div>
                {snapshot ? (
                  <>
                    <div className="field">
                      <div className="flabel">WEATHER INDEX</div>
                      <div className="delay-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={snapshot.disruption.weather_index}
                          onChange={(event) => handleAdjust("weather_index", Number(event.target.value))}
                        />
                        <span className="dval">{snapshot.disruption.weather_index}</span>
                      </div>
                    </div>

                    <div className="field">
                      <div className="flabel">CONGESTION INDEX</div>
                      <div className="delay-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={snapshot.disruption.congestion_index}
                          onChange={(event) => handleAdjust("congestion_index", Number(event.target.value))}
                        />
                        <span className="dval">{snapshot.disruption.congestion_index}</span>
                      </div>
                    </div>

                    <div className="field">
                      <div className="flabel">CUSTOMS DELAY</div>
                      <div className="delay-row">
                        <input
                          type="range"
                          min="0"
                          max="48"
                          disabled={!snapshot.disruption.is_international}
                          value={snapshot.disruption.customs_delay_hours}
                          onChange={(event) => handleAdjust("customs_delay_hours", Number(event.target.value))}
                        />
                        <span className="dval">{snapshot.disruption.customs_delay_hours}h</span>
                      </div>
                    </div>

                    <div className="field">
                      <div className="flabel">FUEL DELTA</div>
                      <div className="delay-row">
                        <input
                          type="range"
                          min="0"
                          max="35"
                          value={snapshot.disruption.fuel_delta_percent}
                          onChange={(event) => handleAdjust("fuel_delta_percent", Number(event.target.value))}
                        />
                        <span className="dval">{snapshot.disruption.fuel_delta_percent}%</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="placeholder-copy">
                    Start a simulation to unlock live disruption sliders for weather, congestion, customs, and fuel.
                  </div>
                )}
              </div>

              <div className="dock-section dock-routes">
                <div className="plabel">{snapshot ? "▸ RANKED ROUTE OPTIONS" : "▸ RECENT ARCHIVE"}</div>
                <div className="dock-route-grid">
                  {snapshot
                    ? snapshot.routes.map((route) => (
                        <RouteCard
                          key={route.code}
                          route={route}
                          snapshot={snapshot}
                          selected={route.code === activeRouteCode}
                          onSelect={setActiveRouteCode}
                        />
                      ))
                    : (dashboard?.scenarios ?? []).map((scenario) => (
                        <ArchiveCard key={scenario.id} scenario={scenario} />
                      ))}
                  {!snapshot && !loading && !(dashboard?.scenarios ?? []).length ? (
                    <div className="placeholder-copy">No archived scenarios available yet.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {showReport && finalReport ? (
        <div className="modal-backdrop">
          <div className="modal">
            <span className="modal-kicker">ROUTE REPORT READY</span>
            <h2>{finalReport.selected_route.title}</h2>
            <p>
              Final recommendation score
              {" "}
              <strong style={{ color: scoreColor(finalReport.recommendation_score) }}>
                {finalReport.recommendation_score}
              </strong>
              {" "}
              for {finalReport.corridor}.
            </p>

            <div className="report-grid">
              <div className="report-row">
                <span>MODE</span>
                <strong>{finalReport.selected_route.mode}</strong>
              </div>
              <div className="report-row">
                <span>ETA</span>
                <strong>{finalReport.selected_route.eta_hours}h</strong>
              </div>
              <div className="report-row">
                <span>COST</span>
                <strong>{formatCurrency(finalReport.selected_route.cost_inr)}</strong>
              </div>
              <div className="report-row">
                <span>CO2</span>
                <strong>{formatNumber(finalReport.selected_route.co2_kg)} kg</strong>
              </div>
              <div className="report-row">
                <span>CUSTOMS BUFFER</span>
                <strong>{finalReport.selected_route.customs_hours}h</strong>
              </div>
              <div className="report-row">
                <span>PRIORITY</span>
                <strong>{priorityLabel(finalReport.priority)}</strong>
              </div>
            </div>

            <div className="modal-actions">
              <button className="modal-btn ghost" type="button" onClick={resetWorkspace}>
                Back to Console
              </button>
              <button
                className="modal-btn solid"
                type="button"
                onClick={() => generateReportPdf(finalReport)}
              >
                Download PDF Report
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
