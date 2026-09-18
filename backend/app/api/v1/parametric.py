"""
Parametric Analysis API  —  /api/v1/parametric
================================================
Supports two source modes:
  - solver  : sweeps variables inside a TBS script
  - canvas  : sweeps component parameters in a saved simulation (runs /run for each point)

Sweep limits (free tier):
  - max 3 variables
  - max 50 total runs per study
"""
from __future__ import annotations

import itertools
import json
import math
import re
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.parametric import ParametricStudy
from app.models.simulation import Simulation, SimulationComponent
from app.api.v1.equation_solver import evaluate_script
from app.core.cycle_engine import run_full_analysis
from app.services.simulation_service import SimulationService, _map_component_params

router = APIRouter(prefix="/parametric", tags=["Parametric Analysis"])

# ── Constants ─────────────────────────────────────────────────────────────────

MAX_VARIABLES   = 5   # UI allows 2–5
MAX_TOTAL_RUNS  = 500 # safety cap
MAX_STEPS_PER_VAR = 50


# ── Schemas ───────────────────────────────────────────────────────────────────

class SweepVariable(BaseModel):
    """One axis in the parametric sweep."""
    name:   str = Field(..., description="Variable name to override in script / canvas param")
    label:  str = Field("", description="Human-readable label for UI")
    min:    float | None = None
    max:    float | None = None
    steps:  int   | None = Field(None, ge=2, le=MAX_STEPS_PER_VAR)
    # Or explicit list of values
    values: list[float] | None = None

    @field_validator("values", mode="after")
    @classmethod
    def check_range_or_values(cls, v, info):
        values = info.data
        has_range = (
            values.get("min") is not None
            and values.get("max") is not None
            and values.get("steps") is not None
        )
        has_values = v is not None and len(v) >= 2
        if not has_range and not has_values:
            raise ValueError("Provide either (min, max, steps) or a list of at least 2 values")
        return v


class OutputKPI(BaseModel):
    name:  str
    label: str = ""


class ParametricRunRequest(BaseModel):
    name:         str = "Parametric Study"
    description:  str = ""
    source_type:  str = "solver"    # 'solver' | 'canvas'
    script:       str | None = None  # for solver mode
    simulation_id: int | None = None # for canvas mode
    variables:    list[SweepVariable] = Field(..., min_length=1, max_length=MAX_VARIABLES)
    outputs:      list[OutputKPI]    = Field(default_factory=list)
    generate_plots: bool = True
    save_study:   bool = True         # persist to DB


class ParametricRunResponse(BaseModel):
    study_id:         int | None
    name:             str
    axes:             list[dict]           # [{name, label, values}]
    outputs:          dict[str, list]      # variable_name → flat list aligned with runs
    run_count:        int
    success_count:    int
    error_count:      int
    execution_time_ms: float
    plot_data:        dict[str, Any] | None
    errors:           list[str]


class ParametricStudyRow(BaseModel):
    id:           int
    name:         str
    description:  str | None
    source_type:  str
    status:       str
    run_count:    int | None
    execution_time_ms: float | None
    generate_plots: bool
    variables_config: list
    output_config:    list
    result_matrix:    dict | None
    plot_data:        dict | None
    created_at:       str
    updated_at:       str

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_axis_values(v: SweepVariable) -> list[float]:
    if v.values and len(v.values) >= 2:
        return [float(x) for x in v.values]
    # linspace from min/max/steps
    mn, mx, n = v.min, v.max, v.steps
    if mn is None or mx is None or n is None or n < 2:
        raise ValueError(f"Sweep variable '{v.name}': provide (min, max, steps>=2) or a values list.")
    return [mn + (mx - mn) * i / (n - 1) for i in range(n)]


def _inject_variables(script: str, overrides: dict[str, float]) -> str:
    """
    Inject parametric overrides into a script so they take effect.

    Strategy: strip every existing top-level assignment for each swept
    variable from the script, then prepend the override assignments.
    This prevents the original `x = something` lines from overwriting
    the injected values when the script executes sequentially.
    """
    cleaned_lines = []
    for line in script.splitlines():
        stripped = line.strip()
        # Skip lines that are plain assignments for any swept variable.
        # Matches:  VarName = ...   (optionally with unit annotation [K] etc.)
        # Does NOT skip CoolProp calls like  h1 = enthalpy(...)
        skip = False
        for var_name in overrides:
            # Pattern: var_name followed by optional whitespace then '='
            # but NOT '==' (comparison). Also exclude if rhs contains '('.
            pattern = re.compile(
                r'^\s*' + re.escape(var_name) + r'\s*=(?!=)\s*[^(]'
            )
            if pattern.match(line):
                skip = True
                break
        if not skip:
            cleaned_lines.append(line)

    override_lines = [f"{k} = {v}" for k, v in overrides.items()]
    return "\n".join(override_lines) + "\n" + "\n".join(cleaned_lines)


def _extract_outputs(variables: dict[str, Any], output_names: list[str]) -> dict[str, float | None]:
    out = {}
    for name in output_names:
        val = variables.get(name)
        if val is not None:
            try:
                out[name] = round(float(val), 8)
            except Exception:
                out[name] = None
        else:
            out[name] = None
    return out


def _flatten_numeric_values(value: Any, prefix: str = "") -> dict[str, float]:
    """Flatten nested dict/list payloads to dotted numeric keys for flexible KPI selection."""
    out: dict[str, float] = {}
    if isinstance(value, dict):
        for k, v in value.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            out.update(_flatten_numeric_values(v, p))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            p = f"{prefix}[{i}]"
            out.update(_flatten_numeric_values(v, p))
    elif isinstance(value, (int, float)) and math.isfinite(float(value)):
        out[prefix] = float(value)
    return out


def _read_dead_state_from_description(sim: Simulation) -> tuple[float, float]:
    """Read saved dead-state from simulation description JSON if available."""
    T0, P0 = 298.15, 101325.0
    if not sim.description:
        return T0, P0
    try:
        payload = json.loads(sim.description)
        T0 = float(payload.get("deadStateT0", T0))
        P0 = float(payload.get("deadStateP0", P0))
    except Exception:
        pass
    return T0, P0


def _apply_canvas_override(
    components: list[dict[str, Any]],
    cycle_type: str,
    override_name: str,
    override_value: float,
    engine_inputs: dict[str, Any],
) -> bool:
    """
    Apply one sweep override to component params and/or engine-level inputs.

    Supported names:
      - engine key, e.g. P_boiler
      - component selectors:
          <component_type>.<param>
          <component_name>.<param>
          <component_id>.<param>
    """
    if "." not in override_name:
        engine_inputs[override_name] = override_value
        return True

    selector, param_key = override_name.split(".", 1)
    selector_norm = selector.strip().lower()
    changed = False

    for comp in components:
        cid = str(comp["id"]).lower()
        ctype = str(comp["component_type"]).lower()
        cname = str(comp["component_name"]).lower()
        if selector_norm in {cid, ctype, cname}:
            comp["parameters"][param_key] = override_value
            changed = True

    # Keep engine-level view in sync for direct mapped keys.
    if changed:
        for comp in components:
            mapped = _map_component_params(comp["component_type"], comp["parameters"], cycle_type)
            for mk, mv in mapped.items():
                engine_inputs.setdefault(mk, mv)
        return True

    # Fall back: try targeting by parameter key name regardless of selector.
    for comp in components:
        if param_key in comp["parameters"]:
            comp["parameters"][param_key] = override_value
            changed = True
    if changed:
        return True

    # Finally treat as direct engine variable.
    engine_inputs[override_name] = override_value
    return True


def _build_canvas_engine_inputs(sim: Simulation, components: list[dict[str, Any]], T0: float, P0: float) -> dict[str, Any]:
    """Build cycle-engine inputs from component/connection graph for one run point."""
    cycle_type = (sim.cycle_type or "").lower().strip() or SimulationService._infer_cycle_type(sim.components or [])
    inputs: dict[str, Any] = {"cycle_type": cycle_type, "T0": T0, "P0": P0}

    conn_mdot_by_target: dict[int, float] = {}
    for conn in sim.connections or []:
        if conn.fluid_name:
            inputs.setdefault("fluid", conn.fluid_name)
        if conn.mass_flow_rate is not None:
            conn_mdot_by_target[conn.to_component_id] = float(conn.mass_flow_rate)
            inputs.setdefault("mass_flow", float(conn.mass_flow_rate))

    for comp in components:
        params = dict(comp.get("parameters") or {})
        if comp["id"] in conn_mdot_by_target and "mass_flow" not in params:
            params["mass_flow"] = conn_mdot_by_target[comp["id"]]
        mapped = _map_component_params(comp["component_type"], params, cycle_type)
        for k, v in mapped.items():
            inputs.setdefault(k, v)
        # Keep arbitrary explicit engine keys if user entered them directly.
        for k, v in params.items():
            if k in {"fluid", "mass_flow", "T0", "P0"}:
                inputs.setdefault(k, v)

    return inputs


def _build_plot_data(
    axes: list[dict],
    output_rows: list[dict],
    output_names: list[str],
) -> dict[str, Any]:
    """
    Build pre-computed series for Recharts.

    For 1-variable sweeps: [{axisValue, kpi1, kpi2, ...}, ...]
    For 2-variable sweeps: heat-map matrix per KPI
    For 3+ variables: first two axes form the grid; rest are labels
    """
    if not axes:
        return {}

    ax0 = axes[0]
    series_map: dict[str, list] = {name: [] for name in output_names}

    if len(axes) == 1:
        for i, row in enumerate(output_rows):
            pt: dict[str, Any] = {ax0["name"]: ax0["values"][i]}
            for name in output_names:
                pt[name] = row.get(name)
            for name in output_names:
                series_map[name].append(pt)
        # Flatten — all share same x-axis
        combined = []
        for i, xv in enumerate(ax0["values"]):
            pt2: dict[str, Any] = {"x": xv, "xLabel": ax0.get("label", ax0["name"])}
            for name in output_names:
                pt2[name] = output_rows[i].get(name)
            combined.append(pt2)
        return {"type": "line", "series": combined, "xAxis": ax0}

    if len(axes) == 2:
        ax1 = axes[1]
        heatmaps: dict[str, list[list]] = {}
        idx = 0
        for name in output_names:
            grid = []
            for _ in ax0["values"]:
                row_vals = []
                for _ in ax1["values"]:
                    row_vals.append(output_rows[idx].get(name) if idx < len(output_rows) else None)
                    idx += 1
                grid.append(row_vals)
                idx -= len(ax1["values"])  # reset inner
            # rebuild properly
            heatmaps[name] = []
        idx = 0
        for i in range(len(ax0["values"])):
            for j in range(len(ax1["values"])):
                for name in output_names:
                    if i == 0:
                        heatmaps[name] = []
                idx += 1
        # simpler: flat scatter
        scatter = []
        for i, row in enumerate(output_rows):
            i0 = i // len(ax1["values"])
            i1 = i  % len(ax1["values"])
            pt3: dict[str, Any] = {
                ax0["name"]: ax0["values"][i0] if i0 < len(ax0["values"]) else None,
                ax1["name"]: ax1["values"][i1] if i1 < len(ax1["values"]) else None,
            }
            for name in output_names:
                pt3[name] = row.get(name)
            scatter.append(pt3)
        return {"type": "scatter", "series": scatter, "xAxis": ax0, "yAxis": ax1}

    # 3+ axes: flat table only, no advanced plot
    return {"type": "table_only"}


# ── Main run endpoint ─────────────────────────────────────────────────────────

@router.post("/run", response_model=ParametricRunResponse)
async def run_parametric(
    body: ParametricRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t0 = time.perf_counter()
    errors: list[str] = []

    # --- Validate variable count
    if len(body.variables) > MAX_VARIABLES:
        raise HTTPException(status_code=422,
                            detail=f"Max {MAX_VARIABLES} variables allowed.")

    # --- Build axes
    axes: list[dict] = []
    axis_values_list: list[list[float]] = []
    for v in body.variables:
        vals = _build_axis_values(v)
        axes.append({"name": v.name, "label": v.label or v.name, "values": vals})
        axis_values_list.append(vals)

    # Total runs = product of all axis lengths
    total_runs = 1
    for vals in axis_values_list:
        total_runs *= len(vals)

    if total_runs > MAX_TOTAL_RUNS:
        raise HTTPException(status_code=422,
                            detail=f"Too many runs ({total_runs}). Max is {MAX_TOTAL_RUNS}.")

    output_names = [o.name for o in body.outputs] if body.outputs else []

    # --- Run the sweep
    output_rows: list[dict] = []   # one dict per run point
    success_count = 0
    error_count   = 0
    all_variable_names: set[str] = set()

    if body.source_type == "solver":
        if not body.script:
            raise HTTPException(status_code=422,
                                detail="script is required for solver-mode parametric studies.")

        base_script = body.script
        for combo in itertools.product(*axis_values_list):
            overrides = {axes[i]["name"]: combo[i] for i in range(len(axes))}
            injected = _inject_variables(base_script, overrides)
            try:
                result = evaluate_script(injected)
                all_variable_names.update(result.variables.keys())
                # If user didn't specify outputs, auto-detect numeric vars
                if not output_names:
                    auto = {k for k, v in result.variables.items()
                            if isinstance(v, (int, float)) and not k.endswith("$")}
                    all_variable_names.update(auto)
                outs = _extract_outputs(result.variables,
                                        output_names if output_names else list(all_variable_names))
                output_rows.append(outs)
                if result.success:
                    success_count += 1
                else:
                    error_count += 1
                    errors.append(f"Run {len(output_rows)}: {'; '.join(result.errors[:2])}")
            except Exception as exc:
                output_rows.append({})
                error_count += 1
                errors.append(f"Run {len(output_rows)}: {str(exc)[:120]}")

    elif body.source_type == "canvas":
        if body.simulation_id is None:
            raise HTTPException(status_code=422, detail="simulation_id is required for canvas-mode sweeps.")

        sim_result = await db.execute(
            select(Simulation)
            .where(Simulation.id == body.simulation_id, Simulation.owner_id == current_user.id)
            .options(
                selectinload(Simulation.components).selectinload(SimulationComponent.incoming_connections),
                selectinload(Simulation.connections),
            )
        )
        sim = sim_result.scalar_one_or_none()
        if not sim:
            raise HTTPException(status_code=404, detail="Simulation not found")

        T0, P0 = _read_dead_state_from_description(sim)
        cycle_type = (sim.cycle_type or "").lower().strip() or SimulationService._infer_cycle_type(sim.components or [])

        base_components = [
            {
                "id": c.id,
                "component_type": c.component_type,
                "component_name": c.component_name,
                "parameters": dict(c.parameters or {}),
            }
            for c in (sim.components or [])
        ]

        for combo in itertools.product(*axis_values_list):
            overrides = {axes[i]["name"]: combo[i] for i in range(len(axes))}
            components = [
                {
                    "id": c["id"],
                    "component_type": c["component_type"],
                    "component_name": c["component_name"],
                    "parameters": dict(c["parameters"]),
                }
                for c in base_components
            ]
            engine_inputs = _build_canvas_engine_inputs(sim, components, T0, P0)

            for var_name, var_value in overrides.items():
                _apply_canvas_override(components, cycle_type, var_name, float(var_value), engine_inputs)
            # Rebuild mapped inputs after overrides so component-level edits win.
            engine_inputs = _build_canvas_engine_inputs(sim, components, T0, P0) | {
                k: v for k, v in engine_inputs.items() if "." not in k
            }

            try:
                raw, _ = run_full_analysis(engine_inputs)
                if raw.get("success"):
                    success_count += 1
                else:
                    error_count += 1
                    errors.append(f"Run {len(output_rows)+1}: {raw.get('error_message', 'cycle solver failed')}")

                flat = _flatten_numeric_values(raw)
                if not output_names:
                    all_variable_names.update(flat.keys())
                output_rows.append(
                    _extract_outputs(
                        flat,
                        output_names if output_names else sorted(all_variable_names),
                    )
                )
            except Exception as exc:
                output_rows.append({})
                error_count += 1
                errors.append(f"Run {len(output_rows)}: {str(exc)[:120]}")
    else:
        raise HTTPException(status_code=422, detail=f"Unknown source_type '{body.source_type}'")

    # If outputs were auto-detected, collapse to a stable sorted list
    if not output_names and all_variable_names:
        output_names = sorted(all_variable_names - {v.name for v in body.variables})

    # Build flat output arrays aligned with output_rows
    outputs_flat: dict[str, list] = {}
    for name in output_names:
        outputs_flat[name] = [row.get(name) for row in output_rows]

    # Build plot data
    plot_data = None
    if body.generate_plots and output_rows:
        try:
            plot_data = _build_plot_data(axes, output_rows, output_names)
        except Exception:
            plot_data = None

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    # Persist to DB
    study_id = None
    if body.save_study:
        try:
            study = ParametricStudy(
                owner_id=current_user.id,
                name=body.name,
                description=body.description,
                source_type=body.source_type,
                simulation_id=body.simulation_id,
                script_snapshot=body.script,
                variables_config=[v.model_dump() for v in body.variables],
                output_config=[o.model_dump() for o in body.outputs],
                result_matrix={
                    "axes": axes,
                    "outputs": outputs_flat,
                    "run_count": total_runs,
                    "success_count": success_count,
                    "error_count": error_count,
                },
                generate_plots=body.generate_plots,
                plot_data=plot_data,
                status="completed" if error_count == 0 else "completed_with_errors",
                execution_time_ms=elapsed_ms,
            )
            db.add(study)
            await db.commit()
            await db.refresh(study)
            study_id = study.id
        except Exception as db_err:
            errors.append(f"DB persist failed: {str(db_err)[:100]}")

    return ParametricRunResponse(
        study_id=study_id,
        name=body.name,
        axes=axes,
        outputs=outputs_flat,
        run_count=total_runs,
        success_count=success_count,
        error_count=error_count,
        execution_time_ms=elapsed_ms,
        plot_data=plot_data,
        errors=errors,
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ParametricStudyRow])
async def list_studies(
    skip:  int = 0,
    limit: int = 50,
    db:    AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ParametricStudy)
        .where(ParametricStudy.owner_id == current_user.id)
        .order_by(ParametricStudy.created_at.desc())
        .offset(skip).limit(limit)
    )
    rows = result.scalars().all()
    out = []
    for r in rows:
        rm = r.result_matrix or {}
        out.append(ParametricStudyRow(
            id=r.id,
            name=r.name,
            description=r.description,
            source_type=r.source_type,
            status=r.status,
            run_count=rm.get("run_count"),
            execution_time_ms=r.execution_time_ms,
            generate_plots=r.generate_plots,
            variables_config=r.variables_config or [],
            output_config=r.output_config or [],
            result_matrix=r.result_matrix,
            plot_data=r.plot_data,
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        ))
    return out


@router.get("/{study_id}", response_model=ParametricStudyRow)
async def get_study(
    study_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ParametricStudy)
        .where(ParametricStudy.id == study_id,
               ParametricStudy.owner_id == current_user.id)
    )
    study = result.scalar_one_or_none()
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    rm = study.result_matrix or {}
    return ParametricStudyRow(
        id=study.id, name=study.name, description=study.description,
        source_type=study.source_type, status=study.status,
        run_count=rm.get("run_count"),
        execution_time_ms=study.execution_time_ms,
        generate_plots=study.generate_plots,
        variables_config=study.variables_config or [],
        output_config=study.output_config or [],
        result_matrix=study.result_matrix,
        plot_data=study.plot_data,
        created_at=study.created_at.isoformat(),
        updated_at=study.updated_at.isoformat(),
    )


@router.delete("/{study_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_study(
    study_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ParametricStudy)
        .where(ParametricStudy.id == study_id,
               ParametricStudy.owner_id == current_user.id)
    )
    study = result.scalar_one_or_none()
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    await db.delete(study)
    await db.commit()
