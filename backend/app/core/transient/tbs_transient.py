"""
ThermoBird v2 — TBS transient script parser.

Two modes are supported:

1. TRANSIENT-SYNTAX MODE (explicit state/derivative declarations):
     state <n> = <value>    — declare ODE state variable with IC
     d<n>/dt   = <expr>     — ODE right-hand side
     t_end     = <value>    — simulation end time [s]
     t_steps   = <value>    — number of output time steps

2. STEADY-STATE INFERENCE MODE (standard TBS scripts):
     Any regular TBS/EES-style script is accepted.
     Components are automatically inferred from the variables present:
       - WorkingFluid$ / Fluid$ / fluid$  → fluid name
       - P_boil / P_high / P3 etc.        → boiler present
       - P_cond / P_low / P1 etc.         → condenser present
       - eta_turbine / eta_t              → turbine present
       - eta_pump / eta_p                 → pump present
       - eta_comp / eta_compressor        → compressor present
       - COP / Q_evap / T_evap            → refrigeration (evaporator)

parse_transient_script(source) -> TransientScriptAST
infer_components_from_script(source) -> list[dict]   <- smart steady-state parser
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TransientScriptAST:
    """Structured representation of a parsed TBS transient script."""
    fluid: str = "Water"
    t_end: float = 600.0
    t_steps: int = 300
    state_vars: dict[str, float] = field(default_factory=dict)
    derivatives: dict[str, str] = field(default_factory=dict)
    algebraic_lines: list[str] = field(default_factory=list)
    # Numeric variables extracted from the script
    script_vars: dict[str, float | None] = field(default_factory=dict)
    # Explicit component metadata tags (preferred over regex inference)
    component_tags: list[dict[str, str]] = field(default_factory=list)
    cycle_tags: list[str] = field(default_factory=list)


# ── Regex patterns ────────────────────────────────────────────────────────────

_RE_STATE         = re.compile(r"^\s*state\s+(\w+)\s*=\s*([^\s/{]+)")
_RE_DERIV         = re.compile(r"^\s*d(\w+)/dt\s*=\s*(.+?)(?:\s*[{].*)?$")
_RE_T_END         = re.compile(r"^\s*t_end\s*=\s*([0-9.eE+\-]+)")
_RE_STEPS         = re.compile(r"^\s*t_steps\s*=\s*([0-9]+)")
_RE_WORKING_FLUID = re.compile(
    r'(?:WorkingFluid|working_fluid|Fluid|fluid)\$\s*=\s*[\'"]([^\'"]+)[\'"]',
    re.IGNORECASE
)
_RE_FLUID_BARE  = re.compile(r"^\s*fluid\s*=\s*[\"']?(\w+)[\"']?")
_RE_BLOCK_CMT   = re.compile(r'\{[^}]*\}')
_RE_STR_CMT     = re.compile(r'"[^"]*"')
_RE_UNIT_ANNOT  = re.compile(r'(?<![A-Za-z0-9_])\[[^\]]*\]')
_RE_NUM_ASSIGN  = re.compile(r"^\s*([A-Za-z_]\w*)\s*=\s*([0-9.eE+\-]+)\s*$")
_RE_BLANK       = re.compile(r"^\s*$")
_RE_INDEXED_VAR = re.compile(r"\b([A-Za-z_]\w*)\[(\d+)\]")
_RE_COMPONENT_TAG = re.compile(r"^\s*\$component\b(.*)$", re.IGNORECASE)
_RE_CYCLE_TAG = re.compile(r"^\s*\$(?:cycle|cylcle)\s*=\s*([A-Za-z0-9_\-]+)", re.IGNORECASE)
_RE_TAG_KV = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*=\s*('(?:[^']*)'|\"(?:[^\"]*)\"|[^\s]+)")


def _strip_comments(line: str) -> str:
    line = _RE_BLOCK_CMT.sub('', line)
    line = _RE_STR_CMT.sub('', line)
    line = _RE_UNIT_ANNOT.sub('', line)
    return line.strip()


def _normalize_indexed_vars(text: str) -> str:
    return _RE_INDEXED_VAR.sub(r"\1_\2", text)


def _parse_tag_attrs(rest: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for m in _RE_TAG_KV.finditer(rest):
        k = m.group(1).strip().lower()
        v = m.group(2).strip().strip("'\"")
        attrs[k] = v
    return attrs


# ── Main TBS parser ───────────────────────────────────────────────────────────

def parse_transient_script(source: str) -> TransientScriptAST:
    """
    Parse a TBS script (transient or steady-state) and return a structured AST.
    Raises ValueError on explicit transient-syntax errors only.
    """
    ast = TransientScriptAST()

    # Detect fluid from the whole source first (any line, any position)
    fluid_match = _RE_WORKING_FLUID.search(source)
    if fluid_match:
        ast.fluid = fluid_match.group(1)

    for lineno, raw in enumerate(source.splitlines(), start=1):
        line = raw.strip()
        if _RE_BLANK.match(line):
            continue

        clean = _strip_comments(raw)
        if not clean:
            continue
        clean = _normalize_indexed_vars(clean)

        m = _RE_COMPONENT_TAG.match(clean)
        if m:
            attrs = _parse_tag_attrs(m.group(1) or "")
            if attrs:
                ast.component_tags.append(attrs)
            continue

        m = _RE_CYCLE_TAG.match(clean)
        if m:
            ast.cycle_tags.append(m.group(1).strip().lower())
            continue

        # fluid = 'X' (bare, without $) — only if not already set
        if not fluid_match:
            m = _RE_FLUID_BARE.match(clean)
            if m:
                ast.fluid = m.group(1)
                ast.algebraic_lines.append(clean)
                continue

        # t_end = ...
        m = _RE_T_END.match(clean)
        if m:
            try:
                ast.t_end = float(m.group(1))
            except ValueError:
                raise ValueError(f"Line {lineno}: invalid t_end value")
            continue

        # t_steps = ...
        m = _RE_STEPS.match(clean)
        if m:
            try:
                ast.t_steps = int(m.group(1))
            except ValueError:
                raise ValueError(f"Line {lineno}: invalid t_steps value")
            continue

        # state <n> = <ic>
        m = _RE_STATE.match(clean)
        if m:
            var, val_str = m.group(1), m.group(2)
            try:
                ast.state_vars[var] = float(val_str)
            except ValueError:
                raise ValueError(f"Line {lineno}: IC for '{var}' must be numeric")
            continue

        # d<n>/dt = <rhs>
        m = _RE_DERIV.match(clean)
        if m:
            var, rhs = m.group(1), m.group(2).strip()
            if var not in ast.state_vars:
                raise ValueError(
                    f"Line {lineno}: derivative for '{var}' declared "
                    f"before 'state {var} = ...'"
                )
            ast.derivatives[var] = rhs
            continue

        # Numeric assignments — capture for component inference
        m = _RE_NUM_ASSIGN.match(clean)
        if m:
            try:
                ast.script_vars[m.group(1)] = float(m.group(2))
            except ValueError:
                ast.script_vars[m.group(1)] = None

        # Everything else → algebraic
        ast.algebraic_lines.append(clean)

    # Validate explicit transient state declarations
    for var in ast.state_vars:
        if var not in ast.derivatives:
            raise ValueError(
                f"State variable '{var}' declared but no 'd{var}/dt' found."
            )

    return ast


# ── Smart component inference from steady-state scripts ──────────────────────

# Each entry: (component_type, [regex_patterns_on_variable_names])
# Score >= 1 matching pattern → component is detected
_COMP_SIGNATURES: list[tuple[str, list[str]]] = [
    ("heliostat_field", [
        r"\bA_field\b", r"\bDNI\b", r"\beta_field\b", r"\bQ_dot_heliostat\b",
    ]),
    ("receiver", [
        r"\beta_CR\b", r"\bQ_dot_salt\b", r"\bQ_dot_lost_CR\b", r"\bT_CR_boundary\b",
    ]),
    ("hrsg", [
        r"\bQ_dot_HRSG\b", r"\beta_HRSG\b", r"\bQ_dot_HRSG_available\b", r"\bS_dot_gen_HRSG\b",
    ]),
    ("steam_turbine", [
        r"\bW_dot_turbine\b", r"\beta_gen_ST\b", r"\beta_turbine\b",
    ]),
    ("orc_turbine", [
        r"\bW_dot_ORC_turb\b", r"\beta_ORC_turb\b",
    ]),
    ("orc_pump", [
        r"\bW_dot_ORC_pump\b", r"\beta_ORC_pump\b",
    ]),
    ("orc_condenser", [
        r"\bQ_dot_ORC_cond\b", r"\bT_ORC_cond\b",
    ]),
    ("solution_heat_exchanger", [
        r"\bQ_dot_SHE\b", r"\bS_dot_gen_SHE\b",
    ]),
    ("boiler", [
        r"\bP_boil\b", r"\bP_high\b", r"\bQ_in\b", r"\bQ_boiler\b",
        r"\bT_superheat\b", r"\bh3\b", r"\bT3\b", r"\bP3\b",
        r"\bUA_boil\b", r"\bT_source\b", r"\beta_boiler\b",
    ]),
    ("pump", [
        r"\beta_pump\b", r"\beta_p\b", r"\bW_pump\b",
        r"\bh2\b", r"\bh2s\b", r"\bv1\b",
    ]),
    ("turbine", [
        r"\beta_turbine\b", r"\beta_t\b", r"\bW_turbine\b",
        r"\bh4\b", r"\bh4s\b", r"\bP_turb\b",
    ]),
    ("condenser", [
        r"\bP_cond\b", r"\bP_low\b", r"\bQ_out\b", r"\bQ_cond\b",
        r"\bh1\b", r"\bx1\b", r"\bT_cond\b",
    ]),
    ("compressor", [
        r"\beta_comp\b", r"\beta_compressor\b", r"\bW_comp\b",
        r"\bP_discharge\b", r"\bh_comp\b",
    ]),
    ("evaporator", [
        r"\bQ_evap\b", r"\bT_evap\b", r"\bCOP\b",
        r"\bQ_refrig\b", r"\bh_evap\b", r"\bx_evap\b",
    ]),
    ("expansion_valve", [
        r"\bh_valve\b", r"\bT_valve\b", r"\bh_exp\b",
        r"\bisenthalpic\b", r"\bthrottl\b",
    ]),
    ("heat_exchanger", [
        r"\bUA_hx\b", r"\bQ_hx\b", r"\bT_hot_in\b",
        r"\beffectiveness\b", r"\bNTU\b", r"\bT_cold_in\b",
    ]),
    ("recuperator", [
        r"\bQ_rec\b", r"\bQ_regen\b", r"\beta_rec\b", r"\bh_rec\b",
    ]),
    ("generator", [
        r"\bQ_gen\b", r"\bT_gen\b", r"\bh_gen\b", r"\bX_gen\b",
    ]),
    ("absorber", [
        r"\bQ_abs\b", r"\bT_abs\b", r"\bX_abs\b", r"\bm_abs\b",
    ]),
    ("solution_pump", [
        r"\bW_sol_pump\b", r"\bh_sol_pump\b", r"\bm_sol\b",
    ]),
]

# Default transient parameters for each component type
_DEFAULT_PARAMS: dict[str, dict] = {
    "heliostat_field": {
        "fluid_mass": 10, "UA_hx": 800, "mass_flow": 1.0,
    },
    "receiver": {
        "wall_mass": 2000, "fluid_mass": 500, "cp_wall": 500,
        "UA_source": 5000, "UA_fluid_wall": 2000,
        "T_source": 900, "P_Pa": 3_000_000, "mass_flow": 2.5,
    },
    "hrsg": {
        "fluid_mass": 100, "UA_hx": 1500, "mass_flow": 1.0,
    },
    "steam_turbine": {
        "eta_isentropic": 0.85, "rotor_inertia": 500, "electrical_load_W": 500_000,
    },
    "orc_turbine": {
        "eta_isentropic": 0.85, "rotor_inertia": 50, "electrical_load_W": 150_000,
    },
    "orc_pump": {"eta_isentropic": 0.80},
    "orc_condenser": {
        "fluid_mass": 50, "UA_condenser": 3000, "T_sink": 298.15, "P_Pa": 300_000, "mass_flow": 1.0,
    },
    "solution_heat_exchanger": {
        "fluid_mass": 40, "UA_hx": 1200, "mass_flow": 0.5,
    },
    "boiler": {
        "wall_mass": 2000, "fluid_mass": 500, "cp_wall": 500,
        "UA_source": 5000, "UA_fluid_wall": 2000,
        "T_source": 900, "P_Pa": 3_000_000, "mass_flow": 2.5,
    },
    "turbine": {
        "eta_isentropic": 0.85, "rotor_inertia": 500,
        "electrical_load_W": 500_000,
    },
    "condenser": {
        "fluid_mass": 50, "UA_condenser": 3000,
        "T_sink": 298.15, "P_Pa": 10_000, "mass_flow": 2.5,
    },
    "pump": {"eta_isentropic": 0.80},
    "compressor": {"eta_isentropic": 0.85, "rotor_inertia": 20},
    "evaporator": {
        "fluid_mass": 30, "UA_evaporator": 2000,
        "T_source": 278.15, "P_Pa": 200_000, "mass_flow": 0.5,
    },
    "expansion_valve": {},
    "heat_exchanger": {
        "fluid_mass": 100, "UA_hx": 1500,
        "T_hot_in": 600, "T_cold_in": 300, "mass_flow": 1.0,
    },
    "recuperator": {
        "fluid_mass": 30, "UA_rec": 1000, "mass_flow": 2.5,
    },
    "generator": {
        "fluid_mass": 50, "UA_gen": 1000,
        "T_source": 360, "mass_flow": 0.2,
    },
    "absorber": {
        "fluid_mass": 50, "UA_abs": 800,
        "T_sink": 308.15, "mass_flow": 0.2,
    },
    "solution_pump": {"eta_isentropic": 0.80},
}

_DEFAULT_ICS: dict[str, dict] = {
    "heliostat_field": {},
    "receiver":       {"T_fluid_boiler": 320, "T_wall_boiler": 330},
    "hrsg":           {"T_hot_out": 500, "T_cold_out": 350},
    "steam_turbine":  {"omega_turbine": 0},
    "orc_turbine":    {"omega_turbine": 0},
    "orc_pump":       {"T_pump_out": 320},
    "orc_condenser":  {"T_fluid_condenser": 310},
    "solution_heat_exchanger": {"T_hot_out": 360, "T_cold_out": 320},
    "boiler":         {"T_fluid_boiler": 320, "T_wall_boiler": 330},
    "turbine":        {"omega_turbine": 0},
    "condenser":      {"T_fluid_condenser": 310},
    "pump":           {"T_pump_out": 320},
    "compressor":     {"omega_compressor": 0},
    "evaporator":     {"T_fluid_evaporator": 278},
    "expansion_valve": {},
    "heat_exchanger": {"T_fluid_hx": 400},
    "recuperator":    {"T_fluid_rec": 400},
    "generator":      {"T_fluid_generator": 340},
    "absorber":       {"T_fluid_absorber": 308},
    "solution_pump":  {},
}

# Script variable → (component_type, param_key, scale_factor)
_SCRIPT_VAR_MAP: list[tuple[str, str, str, float]] = [
    # (script_var_regex, comp_type, param_key, scale)
    (r"^P_boil$",       "boiler",    "P_Pa",           1000.0),   # kPa → Pa
    (r"^T3$",           "boiler",    "T_source",        1.0),
    (r"^T_superheat$",  "boiler",    "T_source",        1.0),
    (r"^mass_flow$",    "boiler",    "mass_flow",       1.0),
    (r"^mdot$",         "boiler",    "mass_flow",       1.0),
    (r"^eta_turbine$",  "turbine",   "eta_isentropic",  1.0),
    (r"^eta_t$",        "turbine",   "eta_isentropic",  1.0),
    (r"^P_cond$",       "condenser", "P_Pa",            1000.0),   # kPa → Pa
    (r"^eta_pump$",     "pump",      "eta_isentropic",  1.0),
    (r"^eta_p$",        "pump",      "eta_isentropic",  1.0),
    (r"^eta_comp$",     "compressor","eta_isentropic",  1.0),
    (r"^T_evap$",       "evaporator","T_source",        1.0),
    (r"^P_evap$",       "evaporator","P_Pa",            1000.0),
]


# ── Canonical alias map (module-level so it's shared by inference + merge) ────

_CANON_ALIASES: dict[str, str] = {
    "steam_turbine":          "turbine",
    "orc_turbine":            "turbine",
    "orc_pump":               "pump",
    "feedwater_pump":         "pump",
    "solution_pump":          "pump",
    "orc_condenser":          "condenser",
    "receiver":               "boiler",
    "solar_receiver":         "boiler",
    "abs_generator":          "boiler",
    "generator":              "boiler",
    "hrsg":                   "heat_exchanger",
    "heliostat_field":        "heat_exchanger",
    "solar_field":            "heat_exchanger",
    "solution_heat_exchanger":"heat_exchanger",
    "regen":                  "recuperator",
    "she":                    "heat_exchanger",
    "absorber":               "condenser",
}


def _canon(comp_type: str) -> str:
    return _CANON_ALIASES.get(comp_type.lower(), comp_type.lower())


def infer_components_from_script(
    source: str,
    script_vars: dict[str, float | None] | None = None,
    component_tags: list[dict[str, str]] | None = None,
    cycle_tags: list[str] | None = None,
) -> list[dict]:
    """
    Analyse a standard steady-state TBS script and return a list of
    transient component configs ordered by thermodynamic flow.

    Parameters
    ----------
    source : str
        Full TBS script text (or joined algebraic lines from AST).
    script_vars : dict
        Numeric variable values extracted during parsing.
    """
    if script_vars is None:
        script_vars = {}
    if component_tags is None:
        component_tags = []
    if cycle_tags is None:
        cycle_tags = []

    # _canon is now a module-level function

    components: list[dict] = []

    if component_tags:
        for i, tag in enumerate(component_tags, start=1):
            raw_type = (tag.get("type") or "heat_exchanger").strip().lower()
            comp_type = _canon(raw_type)
            comp_id = (tag.get("id") or f"{raw_type}_{i}").strip()
            params = dict(_DEFAULT_PARAMS.get(raw_type, _DEFAULT_PARAMS.get(comp_type, {})))
            ics = dict(_DEFAULT_ICS.get(raw_type, _DEFAULT_ICS.get(comp_type, {})))
            _apply_script_values(comp_type, params, ics, script_vars)
            components.append({
                "id": comp_id,
                "type": comp_type,
                "original_type": raw_type,
                "loop": (tag.get("loop") or (cycle_tags[0] if cycle_tags else "custom")).lower(),
                "params": params,
                "initial_conditions": ics,
            })
        return components

    detected_types: list[str] = []
    for comp_type, patterns in _COMP_SIGNATURES:
        for pat in patterns:
            if re.search(pat, source):
                detected_types.append(comp_type)
                break  # one match per component is enough

    # Build component configs
    for i, comp_type in enumerate(detected_types, start=1):
        canon_type = _canon(comp_type)
        params = dict(_DEFAULT_PARAMS.get(comp_type, {}))
        if not params:
            params = dict(_DEFAULT_PARAMS.get(canon_type, {}))
        ics    = dict(_DEFAULT_ICS.get(comp_type, {}))
        if not ics:
            ics = dict(_DEFAULT_ICS.get(canon_type, {}))
        _apply_script_values(canon_type, params, ics, script_vars)
        components.append({
            "id":                 f"{comp_type}_{i}",
            "type":               canon_type,
            "original_type":      comp_type,
            "loop":               cycle_tags[0].lower() if cycle_tags else "inferred",
            "params":             params,
            "initial_conditions": ics,
        })

    return components


def _apply_script_values(
    comp_type: str,
    params: dict,
    ics: dict,
    svars: dict[str, float | None],
) -> None:
    """Override defaults with numeric values found in the script."""
    for var_name, val in svars.items():
        if val is None:
            continue
        for pat, target_comp, param_key, scale in _SCRIPT_VAR_MAP:
            if target_comp == comp_type and re.match(pat, var_name):
                params[param_key] = val * scale
                break


# ── Convert AST → solver config ───────────────────────────────────────────────

def ast_to_solver_config(
    ast: TransientScriptAST,
    canvas_components: list[dict] | None = None,
) -> dict[str, Any]:
    """
    Convert a TransientScriptAST to a solve_transient() config dict.

    Priority:
      1. If AST has explicit 'state' declarations → use those (transient syntax)
      2. Else infer from script variable patterns  → steady-state inference
      3. Canvas components augment/override params if provided
    """
    if ast.state_vars:
        # Explicit transient syntax
        comp_map: dict[str, dict] = {}
        for var, ic in ast.state_vars.items():
            comp_type = _infer_comp_from_var(var)
            if comp_type not in comp_map:
                comp_map[comp_type] = {
                    "id": f"{comp_type}_1",
                    "type": comp_type,
                    "params": dict(_DEFAULT_PARAMS.get(comp_type, {})),
                    "initial_conditions": {},
                }
            comp_map[comp_type]["initial_conditions"][var] = ic
        components = list(comp_map.values())
    else:
        # Steady-state inference mode
        full_text = "\n".join(ast.algebraic_lines)
        components = infer_components_from_script(
            full_text,
            ast.script_vars,
            component_tags=ast.component_tags,
            cycle_tags=ast.cycle_tags,
        )

    # Merge canvas params on top of inferred params
    if canvas_components:
        comp_by_type = {c.get("type"): c for c in components}
        comp_by_orig = {c.get("original_type", ""): c for c in components}
        comp_by_id   = {c.get("id"): c for c in components}
        for cc in canvas_components:
            ct      = (cc.get("type") or "").lower()
            cid     = cc.get("id")
            target  = (
                comp_by_id.get(cid)
                or comp_by_type.get(ct)
                or comp_by_orig.get(ct)
                # also try canonical alias match
                or next(
                    (c for c in components
                     if _canon(c.get("original_type", "")) == _canon(ct)
                     or _canon(c.get("type", "")) == _canon(ct)),
                    None,
                )
            )
            if target is not None:
                target["params"].update(cc.get("params", {}))
                if cc.get("initial_conditions"):
                    target["initial_conditions"].update(cc["initial_conditions"])

    connections: list[dict[str, str]] = []
    if len(components) > 1:
        for i in range(len(components) - 1):
            c_from = components[i].get("id") or f"comp_{i}"
            c_to = components[i + 1].get("id") or f"comp_{i+1}"
            connections.append({
                "from": str(c_from),
                "to": str(c_to),
                "from_port": "outlet",
                "to_port": "inlet",
            })

    return {
        "fluid":        ast.fluid,
        "t_span":       [0.0, ast.t_end],
        "t_eval_steps": ast.t_steps,
        "components":   components,
        "connections":  connections,
    }


def _infer_comp_from_var(var_name: str) -> str:
    """Infer component type from a state variable name (explicit transient mode)."""
    v = var_name.lower()
    for comp_type in (
        "boiler", "turbine", "condenser", "pump",
        "compressor", "evaporator", "generator", "absorber",
    ):
        if comp_type in v:
            return comp_type
    return var_name.split("_")[-1] if "_" in var_name else "boiler"
