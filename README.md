# RouteWise AI

RouteWise AI is a full-stack logistics decision layer inspired by the uploaded DP World presentation. It turns disruption inputs into ranked routing recommendations using the same core technology stack direction from the deck: a React frontend, FastAPI backend, and an architecture prepared for MongoDB, Redis, OpenAI or Claude, LangChain, Docker, and Open-Meteo.

## What This Demo Does

- Starts a live shipment simulation for a chosen corridor
- Scores route alternatives on ETA, cost, and CO2
- Applies weather, congestion, customs, and fuel adjustments in real time
- Surfaces route alerts, recommendation history, and a final PDF decision report
- Mirrors the RouteWise product story from the uploaded presentation

## Current Build Status

- The frontend is a polished RouteWise demo workspace for operators
- The backend exposes a mock decision engine with realistic route alternatives and disruption controls
- The scoring model follows the deck’s weighted logic: ETA 40%, Cost 30%, CO2 30%
- The what-if assistant now runs through a backend assistant endpoint with a built-in scenario fallback when no live LLM credentials are configured
- MongoDB, Redis, OpenAI or Claude, and Open-Meteo are represented as the intended integration stack, with mock data used in this offline build

## Technology Stack

- Frontend: React.js, Vite
- Backend: FastAPI, Python
- Intended data layer: MongoDB, Redis
- Intended AI layer: OpenAI or Claude, LangChain
- Intended data feeds: Open-Meteo
- Deployment: Docker, Render or Railway

## Project Structure

- `frontend/` RouteWise operator dashboard and live simulation UI
- `backend/` FastAPI app for scenario management, scoring, and report payloads
- `backend/requirements-ai.txt` optional packages for live MongoDB, Redis, and LLM integrations
- `Dockerfile` single-service production build
- `render.yaml` Render deployment blueprint

## Local Development

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api/*` requests to `http://127.0.0.1:8000`.

## API Endpoints

- `GET /api/health` health check
- `GET /api/project/overview` RouteWise project overview
- `GET /api/dashboard` seeded logistics recommendations and stack details
- `POST /api/simulations/start` create a new shipment simulation
- `GET /api/simulations/{simulation_id}/snapshot` fetch live recommendation state
- `POST /api/simulations/{simulation_id}/assistant` answer what-if questions against the current scenario context
- `POST /api/simulations/{simulation_id}/conditions` update disruption controls
- `POST /api/simulations/{simulation_id}/end` close the simulation and generate a final report

## Live Assistant Configuration

The assistant works out of the box using server-side scenario reasoning. To enable live OpenAI-compatible responses, set:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- optional `OPENAI_BASE_URL` if you are pointing to a compatible endpoint instead of the default OpenAI base URL

## Upgrading To The Full Stack

To move this demo closer to the full deck architecture, replace the mock engine in [engine.py](/Users/charanronda/Documents/New project/backend/app/engine.py) with:

- MongoDB for live route storage and corridor metadata
- Redis for low-latency scenario caching
- Open-Meteo for weather feeds
- OpenAI or Claude via LangChain for natural-language what-if guidance
- Tailwind CSS and Leaflet.js if you want the UI to match the exact presentation stack more literally

## Deploying

The repository is ready for a single Render web service using the root `Dockerfile`. Keep `/api/health` as the health check path.
