from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .engine import SessionEngine
from .models import (
    AssistantRequest,
    AssistantResponse,
    ConditionUpdateRequest,
    DashboardResponse,
    EndSimulationResponse,
    ProjectOverviewResponse,
    SnapshotResponse,
    StartSimulationRequest,
    StartSimulationResponse,
)
from .overview import get_project_overview

app = FastAPI(title="RouteWise API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = SessionEngine()
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
FRONTEND_INDEX = FRONTEND_DIST / "index.html"


def _frontend_response(path: str = "") -> FileResponse:
    if not FRONTEND_INDEX.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found.")

    if path:
        asset_path = (FRONTEND_DIST / path).resolve()
        if asset_path.is_file() and (asset_path == FRONTEND_DIST.resolve() or FRONTEND_DIST.resolve() in asset_path.parents):
            return FileResponse(asset_path)

    return FileResponse(FRONTEND_INDEX)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/project/overview", response_model=ProjectOverviewResponse)
def project_overview() -> ProjectOverviewResponse:
    return get_project_overview()


@app.get("/api/dashboard", response_model=DashboardResponse)
def get_dashboard() -> DashboardResponse:
    return engine.dashboard()


@app.post("/api/simulations/start", response_model=StartSimulationResponse)
def create_simulation(payload: StartSimulationRequest) -> StartSimulationResponse:
    scenario_name = payload.scenario_name.strip()
    origin = payload.origin.strip()
    destination = payload.destination.strip()

    if not scenario_name:
        raise HTTPException(status_code=400, detail="Scenario name is required.")
    if not origin or not destination:
        raise HTTPException(status_code=400, detail="Origin and destination are required.")

    return engine.start_simulation(
        scenario_name=scenario_name,
        origin=origin,
        destination=destination,
        cargo_tons=payload.cargo_tons,
        priority=payload.priority,
        is_international=payload.is_international,
    )


@app.get("/api/simulations/{simulation_id}/snapshot", response_model=SnapshotResponse)
def get_snapshot(simulation_id: str) -> SnapshotResponse:
    try:
        return engine.get_snapshot(simulation_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Simulation not found.") from error


@app.post("/api/simulations/{simulation_id}/assistant", response_model=AssistantResponse)
def ask_assistant(
    simulation_id: str,
    payload: AssistantRequest,
) -> AssistantResponse:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required.")

    try:
        return engine.ask_assistant(
            simulation_id,
            question=question,
            route_code=payload.route_code,
        )
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Simulation not found.") from error


@app.post("/api/simulations/{simulation_id}/conditions", response_model=SnapshotResponse)
def update_conditions(
    simulation_id: str,
    payload: ConditionUpdateRequest,
) -> SnapshotResponse:
    try:
        return engine.update_conditions(
            simulation_id,
            weather_index=payload.weather_index,
            congestion_index=payload.congestion_index,
            customs_delay_hours=payload.customs_delay_hours,
            fuel_delta_percent=payload.fuel_delta_percent,
        )
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Simulation not found.") from error


@app.post("/api/simulations/{simulation_id}/end", response_model=EndSimulationResponse)
def end_simulation(simulation_id: str) -> EndSimulationResponse:
    try:
        return engine.end_simulation(simulation_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Simulation not found.") from error


@app.get("/", include_in_schema=False)
def serve_frontend_root() -> FileResponse:
    return _frontend_response()


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_asset(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found.")
    return _frontend_response(full_path)
