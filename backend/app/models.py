from __future__ import annotations

from typing import List

from pydantic import BaseModel


class RecommendationBand(BaseModel):
    label: str
    cls: str
    color: str
    message: str


class Alert(BaseModel):
    severity: str
    message: str
    time: str


class HistoryPoint(BaseModel):
    score: int
    time: str


class ScoreSignals(BaseModel):
    eta_reliability: int
    cost_efficiency: int
    carbon_efficiency: int
    disruption_resilience: int
    customs_readiness: int


class DisruptionInputs(BaseModel):
    weather_index: int
    congestion_index: int
    customs_delay_hours: int
    fuel_delta_percent: int
    is_international: bool


class RouteOption(BaseModel):
    code: str
    title: str
    mode: str
    summary: str
    eta_hours: int
    base_eta_hours: int
    customs_hours: int
    cost_inr: int
    co2_kg: int
    score: int
    risk_label: str
    badges: List[str]


class SnapshotResponse(BaseModel):
    simulation_id: str
    scenario_name: str
    origin: str
    destination: str
    corridor: str
    cargo_tons: int
    priority: str
    elapsed_seconds: int
    recommendation_score: int
    recommendation: RecommendationBand
    selected_route_code: str
    selected_route: RouteOption
    signals: ScoreSignals
    disruption: DisruptionInputs
    routes: List[RouteOption]
    alerts: List[Alert]
    history: List[HistoryPoint]
    llm_brief: str


class AssistantRequest(BaseModel):
    question: str
    route_code: str | None = None


class AssistantResponse(BaseModel):
    answer: str
    source: str
    engine_label: str
    status_note: str
    route_code: str | None = None


class StartSimulationRequest(BaseModel):
    scenario_name: str
    origin: str
    destination: str
    cargo_tons: int = 10
    priority: str = "balanced"
    is_international: bool = False


class ConditionUpdateRequest(BaseModel):
    weather_index: int | None = None
    congestion_index: int | None = None
    customs_delay_hours: int | None = None
    fuel_delta_percent: int | None = None


class StartSimulationResponse(BaseModel):
    simulation_id: str
    snapshot: SnapshotResponse


class ScenarioSummary(BaseModel):
    id: str
    name: str
    corridor: str
    recommended_route: str
    score: int
    eta_hours: int
    co2_kg: int
    color: str
    recommendation: RecommendationBand


class WeightRow(BaseModel):
    label: str
    value: str


class StackRow(BaseModel):
    label: str
    value: str


class OverviewFeature(BaseModel):
    title: str
    highlight: str
    description: str


class PipelineStage(BaseModel):
    step: str
    title: str
    description: str
    stack: List[str]


class TechStackItem(BaseModel):
    layer: str
    tools: List[str]
    purpose: str


class ProjectOverviewResponse(BaseModel):
    title: str
    tagline: str
    challenge: str
    solution: str
    outcomes: List[str]
    features: List[OverviewFeature]
    pipeline: List[PipelineStage]
    stack_blueprint: List[TechStackItem]


class DashboardMetrics(BaseModel):
    total_scenarios: int
    average_score: int
    green_wins: int
    review_alerts: int
    customs_flags: int


class DashboardResponse(BaseModel):
    metrics: DashboardMetrics
    scenarios: List[ScenarioSummary]
    weights: List[WeightRow]
    stack: List[StackRow]


class ReportResponse(BaseModel):
    simulation_id: str
    scenario_name: str
    corridor: str
    cargo_tons: int
    priority: str
    generated_at: str
    duration_label: str
    recommendation_score: int
    recommendation: RecommendationBand
    selected_route_code: str
    selected_route: RouteOption
    signals: ScoreSignals
    disruption: DisruptionInputs
    routes: List[RouteOption]
    alerts: List[Alert]
    llm_brief: str


class EndSimulationResponse(BaseModel):
    report: ReportResponse
