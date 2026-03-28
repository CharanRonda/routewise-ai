from __future__ import annotations

from .models import OverviewFeature, PipelineStage, ProjectOverviewResponse, TechStackItem


def get_project_overview() -> ProjectOverviewResponse:
    return ProjectOverviewResponse(
        title="RouteWise AI",
        tagline=(
            "An intelligent decision layer for disrupted supply chains that converts live weather, "
            "congestion, customs, and carbon signals into ranked routing actions."
        ),
        challenge=(
            "Logistics operators can usually see disruptions, but they still lack fast, evidence-backed "
            "guidance on which route to dispatch next. Manual decisions increase costs, miss SLAs, "
            "and hide carbon trade-offs."
        ),
        solution=(
            "RouteWise AI evaluates route alternatives in real time, adds customs-aware ETA buffers, "
            "scores each option across time, cost, and CO2, and surfaces operator-ready recommendations "
            "with what-if style scenario guidance."
        ),
        outcomes=[
            "Cut dispatch decision time from manual back-and-forth into a single ranked recommendation flow.",
            "Expose honest ETAs by adding customs delay, weather, and congestion buffers into every route option.",
            "Make carbon-aware logistics practical with per-shipment CO2 visibility and greener route badges.",
        ],
        features=[
            OverviewFeature(
                title="Disruption detection",
                highlight="Open-Meteo + ops signals",
                description="Monitor weather and corridor pressure to surface where the current plan is losing reliability.",
            ),
            OverviewFeature(
                title="Ranked route alternatives",
                highlight="Weighted scoring engine",
                description="Compare ETA, cost, and CO2 side by side so operators can act instead of just observing.",
            ),
            OverviewFeature(
                title="Customs-aware ETA",
                highlight="International routing logic",
                description="Add clearance time and document risk into ETA planning for cross-border scenarios.",
            ),
            OverviewFeature(
                title="What-if guidance",
                highlight="OpenAI or Claude + LangChain",
                description="Explain how fuel spikes, weather shifts, or customs delays would change the recommendation.",
            ),
        ],
        pipeline=[
            PipelineStage(
                step="01",
                title="Ingest disruption context",
                description="Collect route, shipment, weather, congestion, and customs inputs for the active corridor.",
                stack=["React.js", "Open-Meteo", "MongoDB"],
            ),
            PipelineStage(
                step="02",
                title="Score route alternatives",
                description="Normalize ETA, cost, and CO2 across candidate paths and compute a live recommendation score.",
                stack=["FastAPI", "Python decision engine"],
            ),
            PipelineStage(
                step="03",
                title="Run operator what-ifs",
                description="Layer in scenario reasoning for fuel changes, risk shifts, and sustainability trade-offs.",
                stack=["LangChain", "OpenAI or Claude", "Redis"],
            ),
            PipelineStage(
                step="04",
                title="Deliver dispatch action",
                description="Show ranked options, alerts, report exports, and implementation-ready route guidance.",
                stack=["React.js", "Docker", "Render or Railway"],
            ),
        ],
        stack_blueprint=[
            TechStackItem(
                layer="Frontend",
                tools=["React.js", "Tailwind CSS", "Leaflet.js"],
                purpose="Decision workspace, route cards, operator controls, and geographic storytelling.",
            ),
            TechStackItem(
                layer="Backend",
                tools=["FastAPI", "Python"],
                purpose="Route scoring, disruption processing, API delivery, and report assembly.",
            ),
            TechStackItem(
                layer="Data",
                tools=["MongoDB", "Redis"],
                purpose="Route storage, corridor caching, and low-latency scenario refreshes.",
            ),
            TechStackItem(
                layer="AI",
                tools=["OpenAI or Claude", "LangChain"],
                purpose="What-if reasoning, decision explanations, and operator-facing guidance.",
            ),
            TechStackItem(
                layer="Infra",
                tools=["Docker", "Render", "Railway"],
                purpose="Portable deployment, scalable web hosting, and production rollout readiness.",
            ),
        ],
    )
