# Plan 03 — Backend–Frontend Communication & Code Quality (Research-Enhanced)

> **Goal:** Ensure the code between the backend and frontend is clean, well-structured, properly communicated, and ready for world-class transient analysis capabilities. Address all technical debt before major feature expansion.

---

## 1  Current-State Assessment

### 1.1  Backend → Frontend API Communication

✅ **What works well:**
- Clean RESTful API structure under `/api/v1/`.
- Pydantic schemas (`schemas/transient.py`, `schemas/__init__.py`) define clear request/response contracts.
- Axios-based API client in `frontend/src/lib/api.ts` centralises all HTTP calls.
- JWT-based auth with token refresh is properly implemented.
- Error handling with `extractError()` in Dashboard correctly unwraps FastAPI `detail` responses.

⚠️ **Issues found:**

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | **Mismatched param names between frontend store and backend models** | `transientStore.ts` uses `Q_dot_kW`, `UA_kW_K`, `T_source_K`, but backend `component_models.py` expects `wall_mass`, `UA_source`, `T_source`, `mass_flow`, `P_Pa` etc. | 🔴 **Critical** — params silently ignored |
| 2 | **No shared type definitions** | Frontend types in `types/index.ts` and `store/transientStore.ts` are manually kept in sync with Pydantic schemas. | ⚠️ Drift risk |
| 3 | **`simulation_service.py` is a monolith** (561 lines) | Handles cycle creation, simulation execution, result formatting, and canvas saving all in one file. | 🟡 Maintainability |
| 4 | **Polling-based job status** | `useTransientRunner.ts` polls every 2 seconds via `setInterval`. No exponential backoff. | 🟡 Performance, poor UX |
| 5 | **`_run_job` uses `asyncio.get_event_loop()`** | Deprecated in Python 3.12+. Should use `asyncio.get_running_loop()`. | ⚠️ Future compatibility |
| 6 | **No API versioning enforcement** | Routes are under `/api/v1/` but there's no middleware or schema versioning. | 🟢 Low risk for now |
| 7 | **Error response inconsistency** | Some routes raise `HTTPException(422, detail=...)`, others return `{"success": false, "errors": [...]}`. | 🟡 DX friction |
| 8 | **No request/response validation logging** | Hard to debug mismatches between frontend and backend. | 🟡 Debugging difficulty |

### 1.2  Backend Internal Communication

✅ **What works well:**
- Clean separation: `core/` for engines, `api/v1/` for routes, `services/` for business logic, `models/` for ORM, `schemas/` for validation.
- Transient engine is fully isolated in `core/transient/` with its own `__init__.py`.
- Component pattern: each thermodynamic cycle component extends `BaseComponent`.
- Solvers (`commentary.py`, `energy_balance.py`, `entropy_gen.py`, `exergy.py`) are cleanly separated.

⚠️ **Issues found:**

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | **Duplicated CoolProp wrappers** | `core/transient/thermo_utils.py` duplicates functions from `core/property_engine.py`. | 🔴 **Critical** — code duplication |
| 2 | **Component models don't share with steady-state components** | `core/transient/component_models.py` re-implements energy balances from `core/components/*.py`. | 🔴 **Critical** — divergent physics |
| 3 | **`cycle_engine.py` is 42 KB / ~1100 lines** | Contains all cycle analysis logic. | 🟡 Should be decomposed |
| 4 | **`diagram_engine.py` is 25 KB** | Tightly coupled to `cycle_engine.py` output format. | 🟡 Could be decoupled |
| 5 | **No shared constants** | Dead-state T₀, P₀ appear as magic numbers in multiple files. | 🟡 Inconsistency risk |
| 6 | **No unified property interface** | Different property lookup methods across modules. | 🟡 Maintenance burden |

### 1.3  Frontend Internal Communication

✅ **What works well:**
- Zustand stores provide clean, predictable state management per feature domain.
- Each store is a single file with clear actions and types.
- Components access stores via hooks — no prop drilling.
- `lib/api.ts` is the single gateway for all HTTP calls.

⚠️ **Issues found:**

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | **Dashboard.tsx is 961 lines** | Contains entire app workspace in one file. | 🔴 **Critical** — maintainability |
| 2 | **Landing.tsx is 102 KB** | Likely contains embedded SVGs or large inline styles. | 🟡 Bundle size |
| 3 | **`_handleRunSimulation.ts` is orphaned** | Dead code, never wired up. | 🟡 Dead code |
| 4 | **`lib/templates.ts` and `lib/queries.ts` are near-empty** | Unused or placeholders. | 🟢 Cleanup |
| 5 | **`exportUtils.ts` is 51 KB** | Contains embedded PDF generation logic. | 🟡 Bundle size |
| 6 | **Type definitions scattered** | Types defined inline in multiple files. | 🟡 Discoverability |
| 7 | **No error boundary for transient** | Simulation errors can crash the UI. | ⚠️ Stability |

---

## 2  Research-Informed Architecture

Based on modern engineering software best practices (Linear, Vercel, Figma, Shapr3D):

### 2.1  Real-Time Communication Patterns

**Industry Standard:**
- **Linear, Figma**: WebSocket for real-time collaboration
- **Vercel**: SSE for build logs and deployment status
- **GitHub**: GraphQL subscriptions for real-time updates

**ThermoBird Approach:**
- **SSE (Server-Sent Events)** for transient progress — simple, auto-reconnecting, HTTP-compatible
- **WebSocket** for future collaborative features (multi-user editing)

### 2.2  State Management Best Practices

**From Research:**
- Keep server state separate from client state
- Use optimistic updates for responsive UI
- Implement proper loading/error states

### 2.3  Type Safety

**Industry Trend:**
- Auto-generated types from API contracts (OpenAPI → TypeScript)
- Strict TypeScript configuration
- Runtime validation with Zod/io-ts

---

## 3  Proposed Improvements

### 3.1  Shared Type Contract (Frontend ↔ Backend)

**Recommended Approach — Auto-generated types:**

```python
# scripts/generate_types.py
"""Generate TypeScript types from FastAPI OpenAPI schema."""

import json
import subprocess
from pathlib import Path

def generate_types():
    # Export OpenAPI schema
    result = subprocess.run(
        ["python", "-c", 
         "from app.main import app; import json; print(json.dumps(app.openapi()))"],
        capture_output=True,
        text=True,
        cwd="backend"
    )
    
    spec = json.loads(result.stdout)
    
    # Use openapi-typescript to generate types
    subprocess.run([
        "npx", "openapi-typescript",
        "--input", "-",
        "--output", "frontend/src/types/api.generated.ts"
    ], input=json.dumps(spec), text=True)
    
    print("✓ Generated frontend/src/types/api.generated.ts")

if __name__ == "__main__":
    generate_types()
```

**Generated Types Example:**

```typescript
// frontend/src/types/api.generated.ts

export interface TransientComponentConfig {
  type: "boiler" | "turbine" | "condenser" | "pump";
  params: Record<string, number>;
  initial_conditions: Record<string, number>;
}

export interface TransientConfig {
  fluid: string;
  t_end: number;
  t_steps: number;
  T0: number;
  P0: number;
  rtol: number;
  atol: number;
  components: TransientComponentConfig[];
}

export interface TransientResult {
  job_id: number;
  success: boolean;
  t: number[];
  variables: Record<string, number[]>;
  derived: Record<string, number[]>;
  metadata: {
    fluid: string;
    t_span: number[];
    n_steps: number;
    solver_nfev: number;
    execution_ms: number;
    solver_message: string;
  };
  errors: string[];
}
```

**Usage:**

```typescript
import type { TransientConfig, TransientResult } from '../types/api.generated';

// Type-safe store
interface TransientState {
  config: TransientConfig;
  result: TransientResult | null;
}
```

### 3.2  Backend Refactoring

#### 3.2.1  Unified Thermodynamics Module

```python
# core/thermo.py — SINGLE SOURCE OF TRUTH
"""
Unified thermodynamic property calculations using CoolProp.
All property lookups go through this module.
"""

from typing import Tuple, Optional
from CoolProp.CoolProp import PropsSI, PhaseSI
import logging

logger = logging.getLogger(__name__)

# ── Constants ───────────────────────────────────────────────────────────────
T0_DEFAULT = 298.15    # K — ISO dead-state temperature
P0_DEFAULT = 101_325   # Pa — ISO dead-state pressure
R_UNIVERSAL = 8314.462618  # J/(kmol·K) — 2019 SI definition

# ── Property Lookup ──────────────────────────────────────────────────────────

def enthalpy(T: float, P: float, fluid: str) -> float:
    """Specific enthalpy [J/kg]."""
    try:
        return PropsSI("H", "T", T, "P", P, fluid)
    except Exception as e:
        logger.error(f"Failed to get enthalpy for {fluid} at T={T}, P={P}: {e}")
        raise

def entropy(T: float, P: float, fluid: str) -> float:
    """Specific entropy [J/(kg·K)]."""
    return PropsSI("S", "T", T, "P", P, fluid)

def cp(T: float, P: float, fluid: str) -> float:
    """Specific heat at constant pressure [J/(kg·K)]."""
    return PropsSI("CPMASS", "T", T, "P", P, fluid)

def density(T: float, P: float, fluid: str) -> float:
    """Density [kg/m³]."""
    return PropsSI("D", "T", T, "P", P, fluid)

def saturation_temperature(P: float, fluid: str) -> float:
    """Saturation temperature [K] at given pressure."""
    return PropsSI("T", "P", P, "Q", 0, fluid)

def saturation_pressure(T: float, fluid: str) -> float:
    """Saturation pressure [Pa] at given temperature."""
    return PropsSI("P", "T", T, "Q", 0, fluid)

def phase(T: float, P: float, fluid: str) -> str:
    """Phase identifier (liquid, gas, two-phase, etc.)."""
    return PhaseSI("T", T, "P", P, fluid)

def dead_state(T0: float = T0_DEFAULT, P0: float = P0_DEFAULT, 
               fluid: str = "Water") -> Tuple[float, float]:
    """Returns (h0, s0) at dead state."""
    h0 = enthalpy(T0, P0, fluid)
    s0 = entropy(T0, P0, fluid)
    return h0, s0

# ── Batch Operations ─────────────────────────────────────────────────────────

def get_properties(T: float, P: float, fluid: str, 
                   properties: list[str]) -> dict[str, float]:
    """Get multiple properties in one call."""
    result = {}
    for prop in properties:
        result[prop] = PropsSI(prop, "T", T, "P", P, fluid)
    return result
```

#### 3.2.2  Shared Constants Module

```python
# core/constants.py — All physical constants and defaults

# Dead state (ISO 1989)
T0_DEFAULT = 298.15    # K
P0_DEFAULT = 101_325   # Pa

# Physical constants (2019 SI definitions)
R_UNIVERSAL = 8314.462618  # J/(kmol·K)
AVOGADRO = 6.02214076e23   # mol⁻¹
BOLTZMANN = 1.380649e-23   # J/K

# Solver defaults
DEFAULT_RTOL = 1e-4
DEFAULT_ATOL = 1e-6
DEFAULT_MAX_STEP = 1.0  # s

# Component defaults
DEFAULT_BOILER_WALL_MASS = 200.0  # kg
DEFAULT_BOILER_FLUID_MASS = 80.0  # kg
DEFAULT_TURBINE_INERTIA = 500.0   # kg·m²
DEFAULT_PUMP_ETA = 0.80
DEFAULT_TURBINE_ETA = 0.85
```

#### 3.2.3  Fixed Parameter Mapping

```typescript
// frontend/src/store/transientStore.ts — CORRECTED

export const DEFAULT_RANKINE_COMPONENTS: TransientComponentConfig[] = [
  {
    type: 'boiler',
    params: {
      // CORRECTED: Match backend component_models.py exactly
      wall_mass: 200,           // was: mass_wall
      fluid_mass: 80,           // was: mass_fluid
      UA_source: 5000,          // was: UA_kW_K (also fix units if needed)
      UA_fluid_wall: 2000,      // NEW — was missing
      T_source: 900,            // was: T_source_K
      P_Pa: 3_000_000,
      mass_flow: 2.5,
      cp_wall: 500,
      // REMOVED: Q_dot_kW — not used by BoilerModel
    },
    initial_conditions: { 
      T_fluid_boiler: 320, 
      T_wall_boiler: 330 
    },
  },
  // ... other components
];
```

#### 3.2.4  Service Decomposition

```
services/
├── __init__.py
├── base.py                    # Abstract base classes
├── simulation/
│   ├── __init__.py
│   ├── runner.py             # Execution logic (from simulation_service)
│   ├── crud.py               # Create, read, update, delete
│   ├── state_manager.py      # Job state management
│   └── cache.py              # Result caching
├── canvas/
│   ├── __init__.py
│   ├── service.py            # Canvas save/load
│   └── templates.py          # Template management
├── auth/
│   ├── __init__.py
│   └── service.py            # Auth operations
└── export/
    ├── __init__.py
    ├── csv_exporter.py
    ├── pdf_generator.py
    └── matlab_exporter.py
```

#### 3.2.5  Cycle Engine Decomposition

```
core/
├── cycles/
│   ├── __init__.py
│   ├── base.py               # BaseCycle abstract class
│   ├── state_resolver.py     # State-point calculation
│   ├── efficiency.py         # η_thermal, η_exergy, COP, BWR
│   ├── result_formatter.py   # Format results for API
│   └── validator.py          # Validate cycle configurations
├── components/
│   ├── base.py               # BaseComponent
│   ├── boiler.py
│   ├── turbine.py
│   ├── condenser.py
│   ├── pump.py
│   └── heat_exchanger.py     # NEW
```

### 3.3  Real-Time Streaming (SSE)

#### Backend Implementation

```python
# api/v1/transient.py — SSE endpoint

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
import asyncio
import json

router = APIRouter()

@router.get("/transient/{job_id}/stream")
async def stream_transient_results(job_id: int):
    """Stream transient simulation progress via SSE."""
    
    async def event_generator():
        while True:
            job = await get_job_status(job_id)
            
            if job.status == "pending":
                yield f"event: status\ndata: {json.dumps({'status': 'pending'})}\n\n"
            
            elif job.status == "running":
                yield f"event: progress\ndata: {json.dumps({\n                    'status': 'running',\n                    'progress': job.progress,\n                    'eta_seconds': job.eta_seconds\n                })}\n\n"
                
                # Send partial results every 10%
                if job.partial_results:
                    yield f"event: partial\ndata: {json.dumps({\n                        't': job.partial_results.t,\n                        'variables': job.partial_results.variables\n                    })}\n\n"
            
            elif job.status == "completed":
                yield f"event: complete\ndata: {json.dumps(job.result)}\n\n"
                break
            
            elif job.status == "failed":
                yield f"event: error\ndata: {json.dumps({'error': job.error})}\n\n"
                break
            
            await asyncio.sleep(0.5)  # 2Hz update rate
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
```

#### Frontend Implementation

```typescript
// hooks/useTransientStream.ts

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TransientResult } from '../types/api.generated';

interface StreamState {
  status: 'idle' | 'connecting' | 'streaming' | 'completed' | 'error';
  progress: number;
  partialData: Array<{ t: number; variables: Record<string, number> }>;
  result: TransientResult | null;
  error: string | null;
}

export function useTransientStream() {
  const [state, setState] = useState<StreamState>({
    status: 'idle',
    progress: 0,
    partialData: [],
    result: null,
    error: null,
  });
  
  const esRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const maxReconnectAttempts = 5;
  
  const connect = useCallback((jobId: string) => {
    // Close existing connection
    if (esRef.current) {
      esRef.current.close();
    }
    
    setState(prev => ({ ...prev, status: 'connecting' }));
    
    const es = new EventSource(`/api/v1/transient/${jobId}/stream`);
    esRef.current = es;
    
    es.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setState(prev => ({ ...prev, status: data.status }));
    });
    
    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      setState(prev => ({
        ...prev,
        status: 'streaming',
        progress: data.progress,
      }));
    });
    
    es.addEventListener('partial', (e) => {
      const data = JSON.parse(e.data);
      setState(prev => ({
        ...prev,
        partialData: [...prev.partialData, data],
      }));
    });
    
    es.addEventListener('complete', (e) => {
      const result = JSON.parse(e.data);
      setState(prev => ({
        ...prev,
        status: 'completed',
        result,
      }));
      es.close();
      reconnectAttemptRef.current = 0;
    });
    
    es.addEventListener('error', (e) => {
      const data = JSON.parse(e.data);
      setState(prev => ({
        ...prev,
        status: 'error',
        error: data.error,
      }));
      es.close();
    });
    
    es.onerror = () => {
      // Exponential backoff reconnect
      if (reconnectAttemptRef.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 30000);
        reconnectAttemptRef.current++;
        setTimeout(() => connect(jobId), delay);
      } else {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: 'Connection lost. Please refresh.',
        }));
      }
    };
  }, []);
  
  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);
  
  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);
  
  return { ...state, connect, disconnect };
}
```

### 3.4  Frontend Refactoring

#### 3.4.1  Dashboard Decomposition

```
components/
├── dashboard/
│   ├── DashboardHeader.tsx      # Brand, theme toggle, save button
│   ├── TabBar.tsx               # Main tab navigation with animated indicator
│   ├── TabContent.tsx           # Router for tab content
│   ├── SaveModal.tsx            # Save simulation dialog
│   ├── UserMenu.tsx             # User avatar, settings, logout
│   └── index.ts
├── canvas/
│   ├── CanvasComponent.tsx      # Main canvas wrapper
│   ├── CanvasToolbar.tsx        # Zoom, grid, snap controls
│   ├── ComponentPalette.tsx     # Draggable component library
│   ├── ConnectionManager.tsx    # Line drawing between components
│   └── PropertiesPanel.tsx      # Selected component editor
├── transient/
│   ├── TransientPanel.tsx       # Main transient layout (simplified)
│   ├── ConfigSidebar.tsx        # Left sidebar with component cards
│   ├── RunPanel.tsx             # Right panel with run controls
│   ├── ComponentCard.tsx        # Collapsible component config
│   ├── ResultsPanel.tsx         # Results view (wrapper)
│   ├── ChartContainer.tsx       # Chart with zoom/pan/brush
│   ├── StatGrid.tsx             # Summary statistics
│   └── useTransientStream.ts    # SSE hook
└── shared/
    ├── LoadingSpinner.tsx
    ├── ErrorBoundary.tsx
    ├── AnimatedNumber.tsx       # Count-up animation
    └── Tooltip.tsx
```

#### 3.4.2  Centralized Types

```typescript
// types/index.ts — Central export point

export * from './api.generated';
export * from './transient';
export * from './simulation';
export * from './solver';
export * from './canvas';
export * from './auth';

// types/transient.ts — Additional frontend-only types

export interface TransientChartConfig {
  yAxisScale: 'linear' | 'log';
  showGrid: boolean;
  showLegend: boolean;
  colors: string[];
}

export interface TransientComparison {
  id: string;
  name: string;
  result: TransientResult;
  visible: boolean;
  color: string;
}
```

### 3.5  Error Handling Standardization

```python
# schemas/errors.py — Unified error schema

from pydantic import BaseModel
from enum import Enum
from typing import Optional, List, Any

class ErrorCode(str, Enum):
    # Validation errors
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INVALID_PARAMETER = "INVALID_PARAMETER"
    MISSING_PARAMETER = "MISSING_PARAMETER"
    
    # Simulation errors
    SIMULATION_FAILED = "SIMULATION_FAILED"
    SOLVER_DIVERGED = "SOLVER_DIVERGED"
    INVALID_CONFIGURATION = "INVALID_CONFIGURATION"
    
    # Resource errors
    NOT_FOUND = "NOT_FOUND"
    ALREADY_EXISTS = "ALREADY_EXISTS"
    
    # Auth errors
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    
    # System errors
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"

class APIError(BaseModel):
    """Standardized error response."""
    success: bool = False
    error_code: ErrorCode
    message: str
    details: Optional[List[str]] = None
    field_errors: Optional[dict[str, str]] = None  # For validation errors
    request_id: Optional[str] = None  # For debugging
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": False,
                "error_code": "VALIDATION_ERROR",
                "message": "Invalid simulation configuration",
                "details": ["Boiler pressure exceeds critical pressure for fluid"],
                "field_errors": {
                    "boiler.P_Pa": "Pressure too high"
                }
            }
        }

# middleware/error_handler.py

from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

async def api_error_handler(request: Request, exc: APIException) -> JSONResponse:
    """Handle custom API exceptions."""
    return JSONResponse(
        status_code=_get_status_code(exc.error_code),
        content=APIError(
            error_code=exc.error_code,
            message=exc.message,
            details=exc.details,
            field_errors=exc.field_errors,
        ).dict()
    )

async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Handle Pydantic validation errors."""
    field_errors = {}
    details = []
    
    for error in exc.errors():
        loc = ".".join(str(x) for x in error["loc"])
        field_errors[loc] = error["msg"]
        details.append(f"{loc}: {error['msg']}")
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=APIError(
            error_code=ErrorCode.VALIDATION_ERROR,
            message="Request validation failed",
            details=details,
            field_errors=field_errors,
        ).dict()
    )
```

---

## 4  Execution Priority

### Phase 1: Critical Fixes (Week 1)
| Task | Effort | Owner |
|------|--------|-------|
| Fix parameter name mapping | 0.5 day | Backend + Frontend |
| Extract `core/thermo.py` | 0.5 day | Backend |
| Create `core/constants.py` | 0.25 day | Backend |
| Fix `asyncio.get_event_loop()` | 0.25 day | Backend |

### Phase 2: Type Safety (Week 1-2)
| Task | Effort | Owner |
|------|--------|-------|
| Auto-generate TypeScript types | 0.5 day | Backend |
| Centralize frontend types | 0.5 day | Frontend |
| Remove dead code | 0.5 day | Frontend |

### Phase 3: Real-Time Streaming (Week 2-3)
| Task | Effort | Owner |
|------|--------|-------|
| SSE backend endpoint | 1 day | Backend |
| `useTransientStream` hook | 1 day | Frontend |
| Integrate with TransientPanel | 0.5 day | Frontend |

### Phase 4: Frontend Refactoring (Week 3-4)
| Task | Effort | Owner |
|------|--------|-------|
| Decompose Dashboard.tsx | 1 day | Frontend |
| Decompose TransientPanel | 1 day | Frontend |
| Lazy-load exportUtils | 0.5 day | Frontend |

### Phase 5: Backend Refactoring (Week 4-5)
| Task | Effort | Owner |
|------|--------|-------|
| Decompose simulation_service | 1 day | Backend |
| Decompose cycle_engine | 1.5 days | Backend |
| Standardize error responses | 0.5 day | Backend |

### Phase 6: Testing & Polish (Week 5-6)
| Task | Effort | Owner |
|------|--------|-------|
| Write integration tests | 1 day | Backend |
| Frontend build optimization | 0.5 day | Frontend |
| End-to-end testing | 1 day | Both |

**Total: 6 weeks with 2 developers (1 backend, 1 frontend)**

---

## 5  Verification Checklist

| Item | Verification Method |
|------|---------------------|
| Parameter mapping fixed | Unit test: instantiate DEFAULT_RANKINE_COMPONENTS, send to solve_transient(), assert all params used |
| Shared thermo module | All existing tests pass + new unit tests for thermo.py |
| SSE streaming | Cypress test: start simulation, verify real-time progress updates |
| Dashboard decomposition | Build succeeds, Lighthouse score maintained, no console errors |
| Dead code removed | `grep -r "_handleRunSimulation\|templates.ts\|queries.ts" src/` returns nothing |
| Type safety | `tsc --noEmit` passes with strict mode |
| Error standardization | Integration test triggers 422, asserts APIError schema |
| Performance | Bundle size < 500KB gzipped, API p95 < 200ms |

---

## 6  Success Metrics

| Metric | Before | After Target |
|--------|--------|--------------|
| Code duplication | High (thermo_utils.py vs property_engine.py) | Zero |
| Test coverage | ?% | > 70% |
| Bundle size | ?KB | < 500KB gzipped |
| API response (p95) | ?ms | < 200ms |
| Type safety errors | Many implicit any | Zero with strict mode |
| Frontend load time | ?s | < 2s on 3G |
| Concurrent simulations | ? | 100+ without degradation |

---

*This plan integrates with and supports:*
- *Plan 01: Frontend Reconstruction*
- *Plan 02: Transient Analysis Elevation*  
- *Plan 04: Market Analysis & Positioning*
- *Plan 05: Educational Features & Pedagogy*
