# ThermoBird

An open-source, browser-based thermodynamic cycle analysis platform — property
lookups, an EES-style equation solver, canvas-based cycle simulation, parametric
sweeps, and energy/exergy/entropy results, all in one workspace. Fluid
properties are computed via [CoolProp](http://www.coolprop.org/).



This deployment runs in **public/anonymous mode** — there's no login, no
signup, and no per-user accounts. Everyone who uses a given deployment shares
the same workspace data. Keep that in mind if you self-host this somewhere
public.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS + Vite |
| Backend | FastAPI + SQLAlchemy (async) + Alembic |
| Fluid Properties | CoolProp 6.6 |
| Database | PostgreSQL 15+ (16 used in `docker-compose.yml`) |
| Cache | Redis 7 |

---

## Running it locally

You don't need a software engineering background for this — just patience the
first time through. ThermoBird is two separate programs that both need to be
running at once, each in its own terminal window:

- **The backend** — the calculation engine (Python). It does the actual
  CoolProp lookups, equation solving, and cycle math.
- **The frontend** — the web page you actually look at and click around in
  (this is what opens in your browser).

You'll open two terminal windows and leave both running the whole time
you're using ThermoBird. Closing either one shuts that half down.

### What to install first

Install these once, in this order, before touching the project:

| Tool | What it's for | Get it from |
|---|---|---|
| **Git** | downloads the project's code to your computer | [git-scm.com](https://git-scm.com/downloads) |
| **Python 3.11+** | runs the backend | [python.org](https://www.python.org/downloads/) — on Windows, tick "Add python.exe to PATH" during install |
| **Node.js 20+** | runs the frontend | [nodejs.org](https://nodejs.org/) — pick the LTS version |
| **PostgreSQL** | stores saved simulations (version 15 or newer is fine) | [postgresql.org](https://www.postgresql.org/download/) — **remember the password you set for the `postgres` user during install**, you'll need it in Step 3 |

Redis is optional — ThermoBird works fine without it, just slightly slower on
repeated calculations. Skip it unless you already have it.

> **Shortcut:** if you install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
> instead, it can run PostgreSQL for you with zero manual setup — see the
> Docker option in Step 3 below.

### 1. Download the project

Open a terminal (PowerShell on Windows, Terminal on macOS) and run:

```bash
git clone https://github.com/mohmmed-jamal/ThermoBird.git
cd ThermoBird
```

### 2. Check out the project structure (optional)

Everything backend-related lives in `backend/`, everything frontend-related
in `frontend/`. You'll be moving between these two folders in the steps
below — keep track of which terminal window is in which folder.

### 3. Start the database

Pick **one** of these two options — you don't need both.

**Option A — Docker (simplest, if you installed it above):**

```bash
docker-compose up -d db redis
```

That's it — this creates and starts a database for you automatically.
Skip straight to Step 4.

**Option B — using the PostgreSQL you installed directly:**

1. Make sure the PostgreSQL service is actually *running*. Installers
   usually start it automatically, but it can end up stopped — this is the
   single most common thing that goes wrong in Step 4 below.
   - **Windows:** press `Win + R`, type `services.msc`, press Enter. Find
     the entry named something like `postgresql-x64-<version>`, and if its
     status isn't "Running," right-click it → **Start**.
   - **macOS (Homebrew):** `brew services start postgresql`
   - **Linux:** `sudo systemctl start postgresql`
2. Create the database ThermoBird will use. One way, from a terminal:
   ```bash
   psql -U postgres -c "CREATE DATABASE thermobird;"
   ```
   (It'll ask for the `postgres` user's password — the one you set when
   installing PostgreSQL.)

### 4. Set up and start the backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
```

(You should see `(.venv)` appear at the start of your terminal prompt — that
means it worked.)

```bash
pip install -r requirements.txt

copy .env.example .env       # Windows
# cp .env.example .env       # macOS/Linux
```

Open the new `.env` file in any text editor and set your database password
on this line:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD_HERE@localhost:5432/thermobird
```

If you used the Docker option in Step 3 instead, use these values there
instead:

```
DATABASE_URL=postgresql://thermobird:change-me@localhost:5432/thermobird
```

Now start the backend:

```bash
uvicorn app.main:app --reload --port 8000
```

Wait for the last line printed to say `Application startup complete.` — if
you see a red `ERROR` traceback instead, see **Troubleshooting** below
before moving on. **Leave this terminal window open** — the backend is now
running at http://localhost:8000.

### 5. Set up and start the frontend

Open a **second, separate terminal window** — don't close the one from
Step 4. In the new window:

```bash
cd ThermoBird/frontend
```

⚠️ This step matters more than it looks: you must be *inside* the
`frontend` folder, not the main `ThermoBird` folder, or the next commands
will fail with a "could not read package.json" error.

```bash
npm install

copy .env.example .env       # Windows
# cp .env.example .env       # macOS/Linux

npm run dev
```

Leave this window open too. The frontend is now running at
http://localhost:3000.

### 6. Open it

Go to **http://localhost:3000** in your browser, click **Open Workspace**,
and start building a cycle. Both terminal windows need to stay open in the
background the whole time you're using it.

### Troubleshooting

**Backend prints a red error ending in `Connect call failed` on startup.**
PostgreSQL isn't running. Go back to Step 3, Option B, part 1, and start the
service — then re-run `uvicorn app.main:app --reload --port 8000`.

**`npm error ... Could not read package.json`.** You ran `npm install` or
`npm run dev` from the main `ThermoBird` folder instead of `ThermoBird/frontend`.
Run `cd frontend` (or `cd ThermoBird/frontend` if you're not already inside
`ThermoBird`) and try again — check that your terminal prompt actually shows
`...\frontend>` before re-running the command.

**The Property Estimator tab only shows a short list of fluids (~14), and
calculations fail.** This means the frontend can't reach the backend at all.
Check the backend's terminal window: if it doesn't say
`Application startup complete.` with no errors above it, fix that first
(see the first item above) — the fluid list and every calculation depend on
the backend actually being up.

**Nothing loads at `localhost:3000`.** Make sure the frontend terminal
window (Step 5) is still open and didn't print an error and exit. If it did,
read the last few lines of red text — it'll usually say exactly what's wrong.

---

## Project structure

```
ThermoBird/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # Route handlers (properties, solver, cycles, simulations, parametric)
│   │   ├── core/            # Thermodynamic engine + CoolProp glue
│   │   ├── models/          # SQLAlchemy ORM models
│   │   ├── schemas/         # Pydantic schemas
│   │   ├── services/        # Business logic
│   │   ├── config.py        # Pydantic Settings
│   │   ├── database.py      # Async engine + session
│   │   ├── dependencies.py  # Shared FastAPI dependencies (anonymous-user identity)
│   │   └── main.py          # FastAPI app factory + startup seeding
│   ├── alembic/              # DB migrations
│   ├── tests/                 # Pytest suite
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/       # Canvas, Property, Solver, Results, UI primitives
│   │   ├── pages/            # Landing, Dashboard, Simulations, Profile
│   │   ├── store/             # Zustand state
│   │   └── lib/                # API client (axios)
│   ├── public/                 # Static assets (favicon, etc.)
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml         # Local Postgres + Redis (+ optional backend)
├── LICENSE
└── README.md
```

`_archive/` at the repo root holds retired code from the old authenticated
version of the app (login/signup, JWT, rate limiting, and some internal dev
notes) — kept for reference, not part of the running app.

---

## Key API endpoints

```
GET  /health                              Health check

GET  /api/v1/properties/fluids            List supported fluids
POST /api/v1/properties/calculate         Calculate fluid properties
POST /api/v1/properties/diagrams          T-s / P-h diagram data

POST /api/v1/solver/solve                 Run an equation-solver (TBS) script

POST /api/v1/cycles/solve                 Stateless cycle solve (no persistence)
POST /api/v1/simulations                  Create/save a simulation
GET  /api/v1/simulations                  List simulations
POST /api/v1/simulations/{id}/run         Run a saved simulation
GET  /api/v1/simulations/{id}/results     Get results

POST /api/v1/parametric/...               Parametric sweep endpoints
```

API docs at `/docs` are only served when `ENVIRONMENT=development`.

---

## Contributing

Contributions are welcome — this is an early-stage open-source project, so
expect some rough edges and don't expect instant review turnaround.

1. Fork the repo and create a branch off `main`:
   ```bash
   git checkout -b fix/short-description
   ```
2. Make your change. Keep backend and frontend changes in separate commits
   where reasonable.
3. Run what tests exist before opening a PR:
   ```bash
   cd backend
   pytest tests/
   ```
   There's no frontend test suite yet — a PR that adds one is welcome.
4. Open a pull request against `main` with a short description of *what*
   changed and *why*. Screenshots are appreciated for anything UI-facing.

### Good first areas to contribute in

- Frontend test coverage (currently none)
- Additional cycle types / component models in the canvas
- Transient analysis — the streaming endpoint was removed as dead code
  (see `_archive/scripts/transient_streaming.py`) and needs a working
  replacement wired into `main.py` if you want to pick it up
- Docs — this README, inline code comments, and a CONTRIBUTING.md with more
  detail than the summary above

### Reporting bugs

Open an issue with steps to reproduce, what you expected, and what actually
happened. Backend errors are much easier to diagnose with the relevant
`uvicorn` traceback included.

---

## Deployment

There's no bundled one-click deploy config in this repo right now — the
`backend/Dockerfile` and `frontend/Dockerfile` each build independently, and
`docker-compose.yml` covers local Postgres/Redis/backend only. To deploy:

- **Backend** — build `backend/Dockerfile`, provide `DATABASE_URL`,
  `REDIS_URL`, and `CORS_ORIGINS` as environment variables, and run the
  resulting image behind whatever platform you're using (Render, Fly.io,
  a VPS, etc.).
- **Frontend** — build `frontend/Dockerfile` with `VITE_API_URL` pointing at
  your backend's `/api/v1`, and serve the resulting static build (the image
  ships its own nginx config on port 80).

Since this deployment mode has no auth, treat any public deployment as a
shared, single-tenant workspace — anyone with the URL can see and modify
whatever's in it.

---

## License

MIT — see [LICENSE](./LICENSE).

---

