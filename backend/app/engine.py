from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import json
import os
import random
from typing import Dict, List
from urllib import error as urllib_error
from urllib import request as urllib_request
from uuid import uuid4

from .models import (
    Alert,
    AssistantResponse,
    DashboardMetrics,
    DashboardResponse,
    DisruptionInputs,
    EndSimulationResponse,
    HistoryPoint,
    RecommendationBand,
    ReportResponse,
    RouteOption,
    ScenarioSummary,
    ScoreSignals,
    SnapshotResponse,
    StackRow,
    StartSimulationResponse,
    WeightRow,
)


@dataclass(frozen=True)
class RouteBlueprint:
    code: str
    title: str
    mode: str
    summary: str
    transit_hours: int
    base_cost_inr: int
    base_co2_kg: int
    weather_sensitivity: float
    congestion_sensitivity: float
    fuel_sensitivity: float
    customs_base_hours: int = 0
    customs_readiness: int = 96


DOMESTIC_ROUTES = [
    RouteBlueprint(
        code="A",
        title="Truck Priority Linehaul",
        mode="Truck (Tata Prima)",
        summary="Fastest when highways stay open, but more exposed to rain and fuel volatility.",
        transit_hours=20,
        base_cost_inr=12000,
        base_co2_kg=2616,
        weather_sensitivity=1.15,
        congestion_sensitivity=1.05,
        fuel_sensitivity=1.10,
    ),
    RouteBlueprint(
        code="B",
        title="Truck + Rail Green Corridor",
        mode="Truck + Rail",
        summary="Balanced multimodal option that protects margins and keeps carbon lower during disruption.",
        transit_hours=22,
        base_cost_inr=10500,
        base_co2_kg=980,
        weather_sensitivity=0.60,
        congestion_sensitivity=0.75,
        fuel_sensitivity=0.55,
    ),
    RouteBlueprint(
        code="C",
        title="Alternate Road Diversion",
        mode="Alt Road",
        summary="Cheapest fallback path, but ETA grows quickly as congestion compounds on secondary corridors.",
        transit_hours=25,
        base_cost_inr=9800,
        base_co2_kg=2398,
        weather_sensitivity=0.85,
        congestion_sensitivity=0.90,
        fuel_sensitivity=0.95,
    ),
]


INTERNATIONAL_ROUTES = [
    RouteBlueprint(
        code="A",
        title="Sea Green Lane",
        mode="Sea Freight",
        summary="Lowest carbon path with strong customs readiness, ideal when cost and sustainability matter most.",
        transit_hours=96,
        base_cost_inr=76000,
        base_co2_kg=147,
        weather_sensitivity=0.45,
        congestion_sensitivity=0.85,
        fuel_sensitivity=0.25,
        customs_base_hours=12,
        customs_readiness=93,
    ),
    RouteBlueprint(
        code="B",
        title="Air Express Recovery",
        mode="Air Freight",
        summary="Fastest international recovery lane, but premium cost and carbon profile make it a controlled exception.",
        transit_hours=8,
        base_cost_inr=210000,
        base_co2_kg=5924,
        weather_sensitivity=0.20,
        congestion_sensitivity=0.35,
        fuel_sensitivity=1.20,
        customs_base_hours=6,
        customs_readiness=88,
    ),
    RouteBlueprint(
        code="C",
        title="Road + Sea Feeder",
        mode="Road + Sea",
        summary="Pragmatic fallback corridor that trades a little speed for better cost control than air freight.",
        transit_hours=72,
        base_cost_inr=92000,
        base_co2_kg=780,
        weather_sensitivity=0.70,
        congestion_sensitivity=0.90,
        fuel_sensitivity=0.75,
        customs_base_hours=10,
        customs_readiness=85,
    ),
]


SEED_SCENARIOS = [
    ("Monsoon reroute pack", "Chennai -> Delhi", "Truck + Rail Green Corridor", 88, 22, 980),
    ("Dubai customs buffer", "Mumbai -> Dubai", "Sea Green Lane", 91, 108, 147),
    ("Weekend retail push", "Pune -> Bengaluru", "Truck Priority Linehaul", 73, 19, 2140),
    ("Port overflow recovery", "Nhava Sheva -> Kolkata", "Road + Sea Feeder", 67, 61, 880),
    ("Pharma cold-chain reserve", "Hyderabad -> Chennai", "Truck + Rail Green Corridor", 84, 14, 620),
]


def format_duration(total_seconds: int) -> str:
    minutes = str(total_seconds // 60).zfill(2)
    seconds = str(total_seconds % 60).zfill(2)
    return f"{minutes}:{seconds}"


def clamp(value: float, minimum: int = 0, maximum: int = 100) -> int:
    return max(minimum, min(maximum, int(round(value))))


def format_currency(value: int) -> str:
    return f"INR {value:,}"


def normalize_inverse(value: int, values: List[int]) -> int:
    if not values:
        return 0

    low = min(values)
    high = max(values)
    if high == low:
        return 100
    return clamp(((high - value) / (high - low)) * 100)


def color_for_score(score: int) -> str:
    if score >= 80:
        return "rgba(59, 220, 151, 0.72)"
    if score >= 60:
        return "rgba(255, 190, 99, 0.72)"
    return "rgba(255, 107, 99, 0.72)"


def recommendation_for_score(score: int) -> RecommendationBand:
    if score >= 80:
        return RecommendationBand(
            label="RECOMMEND",
            cls="recommended",
            color="#3bdc97",
            message="Recommended for dispatch. The route is balancing ETA, cost, and CO2 well under the current disruption mix.",
        )
    if score >= 60:
        return RecommendationBand(
            label="REVIEW",
            cls="review",
            color="#ffbe63",
            message="Viable with operator review. Monitor disruption inputs and confirm whether ETA risk is acceptable before dispatch.",
        )
    return RecommendationBand(
        label="REROUTE",
        cls="reroute",
        color="#ff6b63",
        message="Do not dispatch on the current recommendation. Conditions are too costly or unstable without a routing change.",
    )


def risk_label(risk_score: int) -> str:
    if risk_score >= 70:
        return "High Risk"
    if risk_score >= 45:
        return "Watch"
    return "Stable"


def route_family(route: RouteOption) -> str:
    text = f"{route.title} {route.mode}".lower()
    has_road = "truck" in text or "road" in text
    has_rail = "rail" in text
    has_sea = "sea" in text

    if "air" in text:
        return "air"
    if (has_road and has_rail) or (has_road and has_sea) or "multimodal" in text:
        return "multimodal"
    if has_sea:
        return "sea"
    if has_rail:
        return "rail"
    return "road"


@dataclass
class ScenarioState:
    simulation_id: str
    scenario_name: str
    origin: str
    destination: str
    cargo_tons: int
    priority: str
    disruption: DisruptionInputs
    rng: random.Random
    tick: int = 0
    history: List[HistoryPoint] = field(default_factory=list)
    generated_at: datetime = field(default_factory=datetime.utcnow)
    active: bool = True


class SessionEngine:
    def __init__(self) -> None:
        self.sessions: Dict[str, ScenarioState] = {}
        self.completed_scenarios: List[ScenarioSummary] = [
            self._seed_summary(index, name, corridor, route, score, eta, co2)
            for index, (name, corridor, route, score, eta, co2) in enumerate(SEED_SCENARIOS, start=1)
        ]

    def _seed_summary(
        self,
        index: int,
        name: str,
        corridor: str,
        route: str,
        score: int,
        eta_hours: int,
        co2_kg: int,
    ) -> ScenarioSummary:
        recommendation = recommendation_for_score(score)
        return ScenarioSummary(
            id=f"seed-{index}",
            name=name,
            corridor=corridor,
            recommended_route=route,
            score=score,
            eta_hours=eta_hours,
            co2_kg=co2_kg,
            color=color_for_score(score),
            recommendation=recommendation,
        )

    def start_simulation(
        self,
        scenario_name: str,
        origin: str,
        destination: str,
        cargo_tons: int,
        priority: str,
        is_international: bool,
    ) -> StartSimulationResponse:
        simulation_id = uuid4().hex
        normalized_priority = priority.lower().strip()
        if normalized_priority not in {"balanced", "speed", "green"}:
            normalized_priority = "balanced"

        disruption = DisruptionInputs(
            weather_index=54 if not is_international else 32,
            congestion_index=49 if not is_international else 58,
            customs_delay_hours=12 if is_international else 0,
            fuel_delta_percent=8,
            is_international=is_international,
        )
        scenario = ScenarioState(
            simulation_id=simulation_id,
            scenario_name=scenario_name,
            origin=origin,
            destination=destination,
            cargo_tons=max(1, cargo_tons),
            priority=normalized_priority,
            disruption=disruption,
            rng=random.Random(simulation_id),
        )
        self.sessions[simulation_id] = scenario
        snapshot = self._snapshot_for(scenario, advance=False)
        return StartSimulationResponse(simulation_id=simulation_id, snapshot=snapshot)

    def get_snapshot(self, simulation_id: str) -> SnapshotResponse:
        scenario = self.sessions[simulation_id]
        return self._snapshot_for(scenario, advance=True)

    def update_conditions(
        self,
        simulation_id: str,
        *,
        weather_index: int | None = None,
        congestion_index: int | None = None,
        customs_delay_hours: int | None = None,
        fuel_delta_percent: int | None = None,
    ) -> SnapshotResponse:
        scenario = self.sessions[simulation_id]

        if weather_index is not None:
            scenario.disruption.weather_index = clamp(weather_index)
        if congestion_index is not None:
            scenario.disruption.congestion_index = clamp(congestion_index)
        if customs_delay_hours is not None:
            scenario.disruption.customs_delay_hours = clamp(customs_delay_hours, 0, 48)
        if fuel_delta_percent is not None:
            scenario.disruption.fuel_delta_percent = clamp(fuel_delta_percent, 0, 35)

        if not scenario.disruption.is_international:
            scenario.disruption.customs_delay_hours = 0

        return self._snapshot_for(scenario, advance=False)

    def end_simulation(self, simulation_id: str) -> EndSimulationResponse:
        scenario = self.sessions[simulation_id]
        scenario.active = False
        snapshot = self._snapshot_for(scenario, advance=False)
        report = ReportResponse(
            simulation_id=snapshot.simulation_id,
            scenario_name=snapshot.scenario_name,
            corridor=snapshot.corridor,
            cargo_tons=snapshot.cargo_tons,
            priority=snapshot.priority,
            generated_at=datetime.utcnow().isoformat(),
            duration_label=format_duration(snapshot.elapsed_seconds),
            recommendation_score=snapshot.recommendation_score,
            recommendation=snapshot.recommendation,
            selected_route_code=snapshot.selected_route_code,
            selected_route=snapshot.selected_route,
            signals=snapshot.signals,
            disruption=snapshot.disruption,
            routes=snapshot.routes,
            alerts=snapshot.alerts,
            llm_brief=snapshot.llm_brief,
        )
        self.completed_scenarios.insert(
            0,
            ScenarioSummary(
                id=scenario.simulation_id,
                name=scenario.scenario_name,
                corridor=snapshot.corridor,
                recommended_route=snapshot.selected_route.title,
                score=snapshot.recommendation_score,
                eta_hours=snapshot.selected_route.eta_hours,
                co2_kg=snapshot.selected_route.co2_kg,
                color=color_for_score(snapshot.recommendation_score),
                recommendation=snapshot.recommendation,
            ),
        )
        return EndSimulationResponse(report=report)

    def dashboard(self) -> DashboardResponse:
        scenarios = self.completed_scenarios[:6]
        total_scenarios = len(scenarios)
        average_score = (
            round(sum(item.score for item in scenarios) / total_scenarios)
            if total_scenarios
            else 0
        )
        green_wins = len([item for item in scenarios if item.co2_kg <= 1000])
        review_alerts = len([item for item in scenarios if item.score < 80])
        customs_flags = len([item for item in scenarios if item.eta_hours >= 48])

        metrics = DashboardMetrics(
            total_scenarios=total_scenarios,
            average_score=average_score,
            green_wins=green_wins,
            review_alerts=review_alerts,
            customs_flags=customs_flags,
        )

        weights = [
            WeightRow(label="ETA efficiency", value="40%"),
            WeightRow(label="Cost efficiency", value="30%"),
            WeightRow(label="Carbon efficiency", value="30%"),
            WeightRow(label="Weather + congestion", value="Live disruption input"),
            WeightRow(label="Customs delay", value="Added to ETA when international"),
            WeightRow(label="Fuel delta", value="Margin penalty"),
        ]

        stack = [
            StackRow(label="Frontend", value="React.js + Tailwind CSS + Leaflet.js"),
            StackRow(label="Backend", value="FastAPI + Python"),
            StackRow(label="Data", value="MongoDB + Redis"),
            StackRow(label="AI", value="OpenAI or Claude + LangChain"),
            StackRow(label="External", value="Open-Meteo weather feeds"),
            StackRow(label="Infra", value="Docker + Render or Railway"),
        ]

        return DashboardResponse(
            metrics=metrics,
            scenarios=scenarios,
            weights=weights,
            stack=stack,
        )

    def ask_assistant(
        self,
        simulation_id: str,
        *,
        question: str,
        route_code: str | None = None,
    ) -> AssistantResponse:
        scenario = self.sessions[simulation_id]
        snapshot = self._snapshot_for(scenario, advance=False)
        focus_route = self._focus_route(snapshot, route_code)
        live_answer, model_name, live_error = self._live_assistant_reply(
            snapshot,
            focus_route,
            question,
        )

        if live_answer:
            return AssistantResponse(
                answer=live_answer,
                source="live_llm",
                engine_label=f"OPENAI {model_name}",
                status_note="Answered with the configured live model using the current scenario snapshot.",
                route_code=focus_route.code if focus_route else None,
            )

        return AssistantResponse(
            answer=self._fallback_assistant_reply(scenario, snapshot, focus_route, question),
            source="fallback",
            engine_label="SCENARIO ENGINE",
            status_note=self._fallback_status_note(live_error),
            route_code=focus_route.code if focus_route else None,
        )

    def _snapshot_for(self, scenario: ScenarioState, *, advance: bool) -> SnapshotResponse:
        if advance and scenario.active:
            scenario.tick += 45

        routes = self._build_routes(scenario)
        selected_route = routes[0]
        recommendation = recommendation_for_score(selected_route.score)
        signals = self._signals_for_selected_route(scenario, selected_route)
        alerts = self._alerts_for(scenario, selected_route)
        history_point = HistoryPoint(
            score=selected_route.score,
            time=format_duration(scenario.tick),
        )

        if not scenario.history or scenario.history[-1].time != history_point.time:
            scenario.history.append(history_point)

        return SnapshotResponse(
            simulation_id=scenario.simulation_id,
            scenario_name=scenario.scenario_name,
            origin=scenario.origin,
            destination=scenario.destination,
            corridor=f"{scenario.origin} -> {scenario.destination}",
            cargo_tons=scenario.cargo_tons,
            priority=scenario.priority,
            elapsed_seconds=scenario.tick,
            recommendation_score=selected_route.score,
            recommendation=recommendation,
            selected_route_code=selected_route.code,
            selected_route=selected_route,
            signals=signals,
            disruption=scenario.disruption,
            routes=routes,
            alerts=alerts,
            history=scenario.history[-12:],
            llm_brief=self._llm_brief_for(scenario, selected_route),
        )

    def _profiles_for(self, scenario: ScenarioState) -> List[RouteBlueprint]:
        return INTERNATIONAL_ROUTES if scenario.disruption.is_international else DOMESTIC_ROUTES

    def _focus_route(
        self,
        snapshot: SnapshotResponse,
        route_code: str | None,
    ) -> RouteOption:
        if route_code:
            matching_route = next(
                (route for route in snapshot.routes if route.code == route_code),
                None,
            )
            if matching_route:
                return matching_route
        return snapshot.selected_route

    def _fallback_status_note(self, live_error: str | None) -> str:
        if not live_error:
            return "Using built-in scenario reasoning because no live model is configured."
        return f"Using built-in scenario reasoning because the live model path is unavailable: {live_error}"

    def _assistant_context(
        self,
        snapshot: SnapshotResponse,
        focus_route: RouteOption,
        question: str,
    ) -> str:
        route_lines = "\n".join(
            (
                f"- Route {route.code}: {route.title} | {route.mode} | "
                f"ETA {route.eta_hours}h | Cost {format_currency(route.cost_inr)} | "
                f"CO2 {route.co2_kg} kg | Customs {route.customs_hours}h | "
                f"Score {route.score} | Risk {route.risk_label} | "
                f"Badges {', '.join(route.badges) if route.badges else 'none'}"
            )
            for route in snapshot.routes
        )
        alert_lines = "\n".join(
            f"- {alert.severity.upper()}: {alert.message}" for alert in snapshot.alerts
        ) or "- NONE"

        return (
            "Scenario context for RouteWise AI.\n"
            f"Scenario: {snapshot.scenario_name}\n"
            f"Corridor: {snapshot.corridor}\n"
            f"Cargo tons: {snapshot.cargo_tons}\n"
            f"Priority: {snapshot.priority}\n"
            f"Recommendation: Route {snapshot.selected_route.code} - {snapshot.selected_route.title}\n"
            f"Recommendation score: {snapshot.recommendation_score}\n"
            f"Focus route: Route {focus_route.code} - {focus_route.title}\n"
            f"Disruption: weather {snapshot.disruption.weather_index}/100, congestion {snapshot.disruption.congestion_index}/100, "
            f"customs delay {snapshot.disruption.customs_delay_hours}h, fuel delta {snapshot.disruption.fuel_delta_percent}%\n"
            f"Signals: ETA {snapshot.signals.eta_reliability}, cost {snapshot.signals.cost_efficiency}, "
            f"carbon {snapshot.signals.carbon_efficiency}, resilience {snapshot.signals.disruption_resilience}, "
            f"customs {snapshot.signals.customs_readiness}\n"
            "Routes:\n"
            f"{route_lines}\n"
            "Alerts:\n"
            f"{alert_lines}\n"
            f"Summary: {snapshot.llm_brief}\n"
            f"User question: {question}"
        )

    def _live_assistant_reply(
        self,
        snapshot: SnapshotResponse,
        focus_route: RouteOption,
        question: str,
    ) -> tuple[str | None, str | None, str | None]:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return None, None, None

        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        model_name = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        payload = {
            "model": model_name,
            "temperature": 0.2,
            "max_tokens": 280,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are RouteWise AI, a logistics what-if copilot. "
                        "Answer only from the provided scenario data. "
                        "Use exact ETA, cost, CO2, score, or customs numbers when relevant. "
                        "Keep the answer concise, practical, and decision-oriented."
                    ),
                },
                {
                    "role": "user",
                    "content": self._assistant_context(snapshot, focus_route, question),
                },
            ],
        }
        request = urllib_request.Request(
            f"{base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib_request.urlopen(request, timeout=15) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as error:
            return None, model_name, f"HTTP {error.code}"
        except urllib_error.URLError:
            return None, model_name, "network request failed"
        except TimeoutError:
            return None, model_name, "request timed out"
        except json.JSONDecodeError:
            return None, model_name, "response parsing failed"

        answer = self._chat_completion_text(body)
        if not answer:
            return None, model_name, "model returned an empty response"

        return answer.strip(), model_name, None

    def _chat_completion_text(self, payload: dict) -> str:
        choices = payload.get("choices") or []
        if not choices:
            return ""

        message = choices[0].get("message") or {}
        content = message.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(item.get("text", ""))
            return "\n".join(part for part in parts if part)
        return ""

    def _fallback_assistant_reply(
        self,
        scenario: ScenarioState,
        snapshot: SnapshotResponse,
        focus_route: RouteOption,
        question: str,
    ) -> str:
        lower = question.lower()
        recommended = snapshot.selected_route
        runner_up = next(
            (route for route in snapshot.routes if route.code != recommended.code),
            None,
        )
        comparison = self._mode_comparison_reply(snapshot, lower)
        if comparison:
            if "customs" in lower:
                if not snapshot.disruption.is_international:
                    return f"{comparison} This is a domestic scenario, so customs delay is not active."
                return (
                    f"{comparison} {focus_route.title} also carries {focus_route.customs_hours}h "
                    f"of customs-aware buffer, and the live scenario adds "
                    f"{snapshot.disruption.customs_delay_hours}h of clearance delay."
                )
            return comparison

        if any(token in lower for token in ("why", "recommend", "leading", "best route")):
            if runner_up:
                return (
                    f"{snapshot.llm_brief} The closest fallback is {runner_up.title} at "
                    f"{runner_up.eta_hours}h, {format_currency(runner_up.cost_inr)}, and "
                    f"{runner_up.co2_kg} kg CO2."
                )
            return snapshot.llm_brief

        if "lowest carbon" in lower or "lowest co2" in lower or "greenest" in lower:
            green_route = min(snapshot.routes, key=lambda route: route.co2_kg)
            return (
                f"{green_route.title} is the lowest-carbon option at {green_route.co2_kg} kg CO2. "
                f"It is currently modeled at {green_route.eta_hours}h and {format_currency(green_route.cost_inr)}."
            )

        if "cheapest" in lower or "lowest cost" in lower:
            cheapest_route = min(snapshot.routes, key=lambda route: route.cost_inr)
            return (
                f"{cheapest_route.title} is the lowest-cost option at {format_currency(cheapest_route.cost_inr)}. "
                f"It comes with {cheapest_route.eta_hours}h ETA and {cheapest_route.co2_kg} kg CO2."
            )

        if "cost" in lower:
            return (
                f"{focus_route.title} is currently modeled at {format_currency(focus_route.cost_inr)}. "
                f"Against the recommended lane, it is {self._comparison_copy(focus_route, recommended)}."
            )

        if "carbon" in lower or "co2" in lower:
            return (
                f"{focus_route.title} is currently carrying {focus_route.co2_kg} kg CO2. "
                f"Against the recommended lane, it is {self._comparison_copy(focus_route, recommended)}."
            )

        if "score" in lower:
            return (
                f"{focus_route.title} is currently scored at {focus_route.score}. "
                f"The active recommendation, {recommended.title}, is at {recommended.score}."
            )

        if any(token in lower for token in ("fastest", "quickest", "delay", "eta")):
            fastest_route = min(snapshot.routes, key=lambda route: route.eta_hours)
            return (
                f"{fastest_route.title} is the quickest recovery lane at {fastest_route.eta_hours}h. "
                f"Compared with the current recommendation, it is "
                f"{self._comparison_copy(fastest_route, recommended)}"
            )

        if "customs" in lower:
            if not snapshot.disruption.is_international:
                return "This scenario is domestic, so customs delay is not part of the ETA stack right now."
            return (
                f"{focus_route.title} carries {focus_route.customs_hours}h of customs-aware buffer. "
                f"The live disruption setting is adding {snapshot.disruption.customs_delay_hours}h "
                "to all international options."
            )

        if "fuel" in lower:
            resilient_route = min(
                snapshot.routes,
                key=lambda route: self._profile_for_route(scenario, route).fuel_sensitivity,
            )
            return (
                f"If fuel pressure rises further, {resilient_route.title} should hold up best because its "
                f"fuel sensitivity is lower than the other options in this scenario. "
                f"It is currently at {format_currency(resilient_route.cost_inr)} and {resilient_route.eta_hours}h."
            )

        if any(token in lower for token in ("weather", "rain", "storm")):
            resilient_route = min(
                snapshot.routes,
                key=lambda route: self._profile_for_route(scenario, route).weather_sensitivity,
            )
            return (
                f"{resilient_route.title} is the most weather-resilient choice in the current option set. "
                f"It is modeled at {resilient_route.eta_hours}h, with risk flagged as {resilient_route.risk_label}."
            )

        if any(token in lower for token in ("congestion", "traffic", "port")):
            resilient_route = min(
                snapshot.routes,
                key=lambda route: self._profile_for_route(scenario, route).congestion_sensitivity,
            )
            return (
                f"{resilient_route.title} is handling congestion best in the current scenario. "
                f"It holds {resilient_route.eta_hours}h ETA and {format_currency(resilient_route.cost_inr)} under the live inputs."
            )

        if focus_route.code != recommended.code:
            return (
                f"{focus_route.title} is currently {self._comparison_copy(focus_route, recommended)} "
                f"than the recommended lane, {recommended.title}. "
                f"It carries a score of {focus_route.score} versus {recommended.score} for the leader."
            )

        if runner_up:
            return (
                f"{snapshot.llm_brief} The nearest alternative is {runner_up.title}, which is "
                f"{self._comparison_copy(runner_up, recommended)} than the recommended lane."
            )

        return snapshot.llm_brief

    def _profile_for_route(self, scenario: ScenarioState, route: RouteOption) -> RouteBlueprint:
        return next(
            profile for profile in self._profiles_for(scenario) if profile.code == route.code
        )

    def _comparison_copy(self, route: RouteOption, baseline: RouteOption) -> str:
        time_delta = route.eta_hours - baseline.eta_hours
        cost_delta = route.cost_inr - baseline.cost_inr
        carbon_delta = route.co2_kg - baseline.co2_kg

        time_copy = (
            "matching ETA"
            if time_delta == 0
            else f"{abs(time_delta)}h faster"
            if time_delta < 0
            else f"{time_delta}h slower"
        )
        cost_copy = (
            "the same cost"
            if cost_delta == 0
            else f"{format_currency(abs(cost_delta))} cheaper"
            if cost_delta < 0
            else f"{format_currency(cost_delta)} more expensive"
        )
        carbon_copy = (
            "the same carbon load"
            if carbon_delta == 0
            else f"{abs(carbon_delta)} kg less CO2"
            if carbon_delta < 0
            else f"{carbon_delta} kg more CO2"
        )
        return f"{time_copy}, {cost_copy}, and running {carbon_copy}"

    def _mode_comparison_reply(
        self,
        snapshot: SnapshotResponse,
        question_lower: str,
    ) -> str | None:
        requested_families: List[str] = []
        family_keywords = {
            "road": ("road", "truck"),
            "rail": ("rail",),
            "sea": ("sea", "ocean", "vessel"),
            "air": ("air", "flight"),
            "multimodal": ("multi", "multimodal"),
        }

        for family, keywords in family_keywords.items():
            if any(keyword in question_lower for keyword in keywords):
                requested_families.append(family)

        if len(requested_families) < 2:
            return None

        left_family, right_family = requested_families[:2]
        left_route = next(
            (route for route in snapshot.routes if route_family(route) == left_family),
            None,
        )
        right_route = next(
            (route for route in snapshot.routes if route_family(route) == right_family),
            None,
        )
        if not left_route or not right_route:
            return None

        cheaper = left_route if left_route.cost_inr <= right_route.cost_inr else right_route
        faster = left_route if left_route.eta_hours <= right_route.eta_hours else right_route
        greener = left_route if left_route.co2_kg <= right_route.co2_kg else right_route

        return (
            f"{left_route.title} is at {left_route.eta_hours}h, {format_currency(left_route.cost_inr)}, "
            f"and {left_route.co2_kg} kg CO2. {right_route.title} is at {right_route.eta_hours}h, "
            f"{format_currency(right_route.cost_inr)}, and {right_route.co2_kg} kg CO2. "
            f"{cheaper.title} is cheaper, {faster.title} is faster, and {greener.title} is greener."
        )

    def _priority_adjusted_score(
        self,
        scenario: ScenarioState,
        *,
        time_score: int,
        cost_score: int,
        carbon_score: int,
    ) -> int:
        base_score = (time_score * 0.4) + (cost_score * 0.3) + (carbon_score * 0.3)
        if scenario.priority == "speed":
            adjusted = (base_score * 0.7) + (time_score * 0.3)
        elif scenario.priority == "green":
            adjusted = (base_score * 0.7) + (carbon_score * 0.3)
        else:
            adjusted = base_score
        return clamp(adjusted)

    def _build_routes(self, scenario: ScenarioState) -> List[RouteOption]:
        profiles = self._profiles_for(scenario)
        preliminary_rows = []

        for profile in profiles:
            weather_penalty = round((scenario.disruption.weather_index / 100) * 5 * profile.weather_sensitivity)
            congestion_penalty = round((scenario.disruption.congestion_index / 100) * 4 * profile.congestion_sensitivity)
            customs_hours = profile.customs_base_hours
            if scenario.disruption.is_international:
                customs_hours += scenario.disruption.customs_delay_hours

            fuel_multiplier = 1 + ((scenario.disruption.fuel_delta_percent / 100) * profile.fuel_sensitivity)
            cost_inr = round(
                (profile.base_cost_inr * fuel_multiplier)
                + (weather_penalty * 260)
                + (congestion_penalty * 190)
                + (customs_hours * 110)
                + (scenario.cargo_tons * 35)
            )
            cost_inr = int(round(cost_inr / 10) * 10)
            eta_hours = profile.transit_hours + weather_penalty + congestion_penalty + customs_hours
            co2_kg = round(
                profile.base_co2_kg
                * (1 + (weather_penalty * 0.02) + (congestion_penalty * 0.015))
                * (1 + max(0, scenario.cargo_tons - 10) * 0.015)
            )
            raw_risk = clamp(
                (scenario.disruption.weather_index * profile.weather_sensitivity * 0.45)
                + (scenario.disruption.congestion_index * profile.congestion_sensitivity * 0.40)
                + (scenario.disruption.customs_delay_hours * (1.4 if scenario.disruption.is_international else 0))
                + (scenario.disruption.fuel_delta_percent * profile.fuel_sensitivity * 0.8),
            )
            preliminary_rows.append(
                {
                    "profile": profile,
                    "eta_hours": eta_hours,
                    "cost_inr": cost_inr,
                    "co2_kg": co2_kg,
                    "customs_hours": customs_hours,
                    "raw_risk": raw_risk,
                }
            )

        eta_values = [row["eta_hours"] for row in preliminary_rows]
        cost_values = [row["cost_inr"] for row in preliminary_rows]
        co2_values = [row["co2_kg"] for row in preliminary_rows]

        scored_rows = []
        for row in preliminary_rows:
            time_score = normalize_inverse(row["eta_hours"], eta_values)
            cost_score = normalize_inverse(row["cost_inr"], cost_values)
            carbon_score = normalize_inverse(row["co2_kg"], co2_values)
            score = self._priority_adjusted_score(
                scenario,
                time_score=time_score,
                cost_score=cost_score,
                carbon_score=carbon_score,
            )
            row.update(
                {
                    "time_score": time_score,
                    "cost_score": cost_score,
                    "carbon_score": carbon_score,
                    "score": score,
                }
            )
            scored_rows.append(row)

        min_eta = min(eta_values)
        min_cost = min(cost_values)
        min_co2 = min(co2_values)
        best_score = max(row["score"] for row in scored_rows)

        routes = []
        for row in scored_rows:
            profile = row["profile"]
            badges: List[str] = []
            if row["score"] == best_score:
                badges.append("BEST SCORE")
            if row["eta_hours"] == min_eta:
                badges.append("FASTEST")
            if row["cost_inr"] == min_cost:
                badges.append("LOWEST COST")
            if row["co2_kg"] == min_co2:
                badges.append("GREEN")
            if row["customs_hours"] > 0:
                badges.append("CUSTOMS-AWARE")

            routes.append(
                RouteOption(
                    code=profile.code,
                    title=profile.title,
                    mode=profile.mode,
                    summary=profile.summary,
                    eta_hours=row["eta_hours"],
                    base_eta_hours=profile.transit_hours + profile.customs_base_hours,
                    customs_hours=row["customs_hours"],
                    cost_inr=row["cost_inr"],
                    co2_kg=row["co2_kg"],
                    score=row["score"],
                    risk_label=risk_label(row["raw_risk"]),
                    badges=badges,
                )
            )

        return sorted(routes, key=lambda item: item.score, reverse=True)

    def _signals_for_selected_route(
        self,
        scenario: ScenarioState,
        selected_route: RouteOption,
    ) -> ScoreSignals:
        matching_profile = next(
            profile for profile in self._profiles_for(scenario) if profile.code == selected_route.code
        )
        eta_values = [route.eta_hours for route in self._build_routes(scenario)]
        cost_values = [route.cost_inr for route in self._build_routes(scenario)]
        co2_values = [route.co2_kg for route in self._build_routes(scenario)]

        eta_reliability = normalize_inverse(selected_route.eta_hours, eta_values)
        cost_efficiency = normalize_inverse(selected_route.cost_inr, cost_values)
        carbon_efficiency = normalize_inverse(selected_route.co2_kg, co2_values)
        disruption_resilience = clamp(
            100
            - (
                scenario.disruption.weather_index * matching_profile.weather_sensitivity * 0.35
                + scenario.disruption.congestion_index * matching_profile.congestion_sensitivity * 0.35
                + scenario.disruption.fuel_delta_percent * matching_profile.fuel_sensitivity * 0.9
            )
        )
        customs_readiness = clamp(
            (
                matching_profile.customs_readiness
                if scenario.disruption.is_international
                else 96
            )
            - (scenario.disruption.customs_delay_hours * (2.4 if scenario.disruption.is_international else 0))
        )

        return ScoreSignals(
            eta_reliability=eta_reliability,
            cost_efficiency=cost_efficiency,
            carbon_efficiency=carbon_efficiency,
            disruption_resilience=disruption_resilience,
            customs_readiness=customs_readiness,
        )

    def _alerts_for(self, scenario: ScenarioState, selected_route: RouteOption) -> List[Alert]:
        alerts: List[Alert] = []
        time_label = format_duration(scenario.tick)

        if scenario.disruption.weather_index >= 60:
            alerts.append(
                Alert(
                    severity="high",
                    message="Weather disruption is stretching road-dependent ETAs. Protecting the corridor requires buffer-aware routing.",
                    time=time_label,
                )
            )
        if scenario.disruption.congestion_index >= 55:
            alerts.append(
                Alert(
                    severity="medium",
                    message="Terminal and corridor congestion are reducing schedule certainty on single-mode plans.",
                    time=time_label,
                )
            )
        if scenario.disruption.is_international and scenario.disruption.customs_delay_hours > 0:
            alerts.append(
                Alert(
                    severity="medium",
                    message=f"Customs buffer of {scenario.disruption.customs_delay_hours} hours has been added to all international ETAs.",
                    time=time_label,
                )
            )
        if scenario.disruption.fuel_delta_percent >= 12:
            alerts.append(
                Alert(
                    severity="low",
                    message="Fuel inflation is eroding pure trucking margins faster than multimodal options.",
                    time=time_label,
                )
            )
        if "GREEN" in selected_route.badges:
            alerts.append(
                Alert(
                    severity="low",
                    message="Selected route holds the strongest carbon profile in the option set, supporting ESG reporting.",
                    time=time_label,
                )
            )

        return alerts[:4]

    def _llm_brief_for(self, scenario: ScenarioState, selected_route: RouteOption) -> str:
        priority_copy = {
            "balanced": "keeps time, cost, and carbon in balance",
            "speed": "leans into the fastest viable recovery",
            "green": "protects the lowest-carbon dispatch path",
        }[scenario.priority]

        customs_copy = ""
        if scenario.disruption.is_international:
            customs_copy = (
                f" Customs-aware ETA is {selected_route.eta_hours} hours, including "
                f"{selected_route.customs_hours} hours of clearance buffer."
            )

        return (
            f"{selected_route.title} is leading for {scenario.origin} -> {scenario.destination} because it "
            f"{priority_copy}. The current recommendation projects {selected_route.eta_hours} hours, "
            f"INR {selected_route.cost_inr:,}, and {selected_route.co2_kg:,} kg CO2 under the live disruption mix."
            f"{customs_copy} If fuel rises further, the current weighting still keeps the chosen route ahead of the pack."
        )
