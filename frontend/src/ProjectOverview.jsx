export const fallbackProjectOverview = {
  title: "RouteWise AI",
  tagline:
    "An intelligent decision layer for disrupted supply chains that ranks route options across time, cost, and carbon impact.",
  challenge:
    "Logistics teams can see disruptions but still rely on spreadsheets, calls, and guesswork when they need a dispatch decision right now.",
  solution:
    "RouteWise AI combines disruption signals, customs-aware ETA buffers, and weighted route scoring into one operator-facing recommendation workspace.",
  outcomes: [
    "Reduce dispatch decision time from hours to seconds with ranked route alternatives.",
    "Expose honest ETA commitments by layering weather, congestion, and customs delays into every option.",
    "Support ESG goals with visible per-shipment CO2 values and greener route recommendations.",
  ],
  features: [
    {
      title: "Disruption detection",
      highlight: "Open-Meteo + ops signals",
      description:
        "Blend weather, congestion, and corridor pressure into live decision context before delays compound.",
    },
    {
      title: "Route alternative scoring",
      highlight: "Weighted engine",
      description:
        "Rank options using ETA, cost, and CO2 instead of forcing operators to compare spreadsheets manually.",
    },
    {
      title: "Customs-aware ETA",
      highlight: "Cross-border logic",
      description:
        "Include customs buffers and document-sensitive delays for international dispatch planning.",
    },
    {
      title: "What-if guidance",
      highlight: "OpenAI or Claude + LangChain",
      description:
        "Explain how a new fuel spike, customs hold, or weather change would alter the recommendation.",
    },
  ],
  pipeline: [
    {
      step: "01",
      title: "Capture shipment context",
      description:
        "Load the corridor, cargo weight, and disruption environment for the active shipment scenario.",
      stack: ["React.js", "MongoDB", "Open-Meteo"],
    },
    {
      step: "02",
      title: "Score route alternatives",
      description:
        "Normalize ETA, cost, and CO2 so every route can be compared inside the same decision model.",
      stack: ["FastAPI", "Python"],
    },
    {
      step: "03",
      title: "Run what-if analysis",
      description:
        "Test how the recommendation shifts under fuel, congestion, and customs changes.",
      stack: ["LangChain", "OpenAI or Claude", "Redis"],
    },
    {
      step: "04",
      title: "Deliver dispatch action",
      description:
        "Show ranked options, risk alerts, and downloadable operator reports for execution teams.",
      stack: ["Docker", "Render or Railway"],
    },
  ],
  stack_blueprint: [
    {
      layer: "Frontend",
      tools: ["React.js", "Tailwind CSS", "Leaflet.js"],
      purpose:
        "Decision workspace, route visual storytelling, and operator controls.",
    },
    {
      layer: "Backend",
      tools: ["FastAPI", "Python"],
      purpose:
        "Route scoring, disruption processing, and report assembly.",
    },
    {
      layer: "Data",
      tools: ["MongoDB", "Redis"],
      purpose:
        "Route storage, corridor caching, and fast scenario refreshes.",
    },
    {
      layer: "AI",
      tools: ["OpenAI or Claude", "LangChain"],
      purpose:
        "Natural-language what-if reasoning and decision explanations.",
    },
    {
      layer: "Infra",
      tools: ["Docker", "Render", "Railway"],
      purpose:
        "Portable deployment and scale-ready delivery.",
    },
  ],
};

export function ProjectOverviewPanel({ overview }) {
  const data = overview || fallbackProjectOverview;

  return (
    <div className="overview-shell">
      <div className="overview-grid">
        <section className="overview-card overview-story">
          <div className="section-label section-label-accent">Problem statement</div>
          <h2>{data.title}</h2>
          <p className="overview-lead">{data.tagline}</p>
          <div className="story-block">
            <span>Challenge</span>
            <p>{data.challenge}</p>
          </div>
          <div className="story-block">
            <span>Proposed solution</span>
            <p>{data.solution}</p>
          </div>
        </section>

        <section className="overview-card">
          <div className="section-label section-label-accent">Operator outcomes</div>
          <div className="outcome-list">
            {data.outcomes.map((outcome) => (
              <div className="outcome-item" key={outcome}>
                {outcome}
              </div>
            ))}
          </div>
          <div className="overview-note">
            This build uses a mock route database and decision engine, but it is structured around
            the same React, FastAPI, MongoDB, Redis, and LLM stack presented in the deck.
          </div>
        </section>
      </div>

      <section className="overview-card">
        <div className="section-label section-label-accent">Core modules</div>
        <div className="feature-card-grid">
          {data.features.map((feature) => (
            <article className="feature-card" key={feature.title}>
              <div className="feature-highlight">{feature.highlight}</div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="overview-card">
        <div className="section-label section-label-accent">Decision pipeline</div>
        <div className="pipeline-grid">
          {data.pipeline.map((stage) => (
            <article className="pipeline-step" key={stage.step}>
              <div className="pipeline-badge">{stage.step}</div>
              <h3>{stage.title}</h3>
              <p>{stage.description}</p>
              <div className="pipeline-stack">
                {stage.stack.map((item) => (
                  <span className="pipeline-pill" key={`${stage.step}-${item}`}>
                    {item}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="overview-card">
        <div className="section-label section-label-accent">Technology stack</div>
        <div className="stack-blueprint">
          {data.stack_blueprint.map((item) => (
            <article className="blueprint-card" key={item.layer}>
              <div className="blueprint-label">{item.layer}</div>
              <h3>{item.tools.join(" + ")}</h3>
              <p>{item.purpose}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
