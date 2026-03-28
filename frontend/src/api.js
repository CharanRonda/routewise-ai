const jsonHeaders = {
  "Content-Type": "application/json",
};

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function parseResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Request failed");
  }
  return response.json();
}

export async function fetchDashboard() {
  const response = await fetch(apiUrl("/api/dashboard"));
  return parseResponse(response);
}

export async function fetchProjectOverview() {
  const response = await fetch(apiUrl("/api/project/overview"));
  return parseResponse(response);
}

export async function startSimulation(payload) {
  const response = await fetch(apiUrl("/api/simulations/start"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function fetchSnapshot(simulationId) {
  const response = await fetch(apiUrl(`/api/simulations/${simulationId}/snapshot`));
  return parseResponse(response);
}

export async function askAssistant(simulationId, payload) {
  const response = await fetch(apiUrl(`/api/simulations/${simulationId}/assistant`), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function updateConditions(simulationId, payload) {
  const response = await fetch(apiUrl(`/api/simulations/${simulationId}/conditions`), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function endSimulation(simulationId) {
  const response = await fetch(apiUrl(`/api/simulations/${simulationId}/end`), {
    method: "POST",
  });
  return parseResponse(response);
}
