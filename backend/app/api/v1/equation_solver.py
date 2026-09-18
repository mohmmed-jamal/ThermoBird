"""
ThermoBird — EES-style Equation Solver  (equation_solver.py)

Supported TBS (ThermoBird Script) syntax:
  - Assignments:          x = 5
  - Arithmetic:           W_net = W_turbine - W_pump
  - String comments:      "any text in double quotes"
  - Block comments:       { block comment }
  - Unit annotations:     T0 = 298 [K]    (bracket content stripped, value unchanged)
  - Fluid string vars:    WorkingFluid$ = 'R245fa'
  - CoolProp lookups:     h1 = enthalpy(WorkingFluid$, P=P1, T=T1)

USER-FACING UNIT CONVENTION (all TBS scripts use these units):
  Pressure    → kPa         e.g.  P_boil = 3000    { 3 MPa }
  Enthalpy    → kJ/kg       e.g.  h1 = enthalpy(...)  { result in kJ/kg }
  Entropy     → kJ/(kg·K)
  Int. Energy → kJ/kg
  Temperature → K           (unchanged)
  Quality, Density, Volume → SI as-is

CoolProp inputs are auto-scaled ×1000 (kPa→Pa, kJ→J) before PropsSI,
and outputs are auto-scaled ÷1000 back to display units.  Scripts never
need to see raw Pa or J/kg values.

CoolProp property keywords (case-insensitive):
  enthalpy / h, entropy / s, temperature / t, pressure / p,
  density / d, volume / v, quality / x, internal_energy / u,
  cp, cv, viscosity, conductivity, speed_of_sound / a
"""
from __future__ import annotations

import ast
import re
import math
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.dependencies import get_current_user

try:
    from CoolProp.CoolProp import PropsSI
    COOLPROP_AVAILABLE = True
except ImportError:
    COOLPROP_AVAILABLE = False
    PropsSI = None

# Import LiBr-H2O solution property correlations
try:
    from app.core.librh2o_props import h_librh2o, s_librh2o
    LIBRH2O_AVAILABLE = True
except ImportError:
    LIBRH2O_AVAILABLE = False
    h_librh2o = None
    s_librh2o = None

# Import NaK liquid metal property correlations
try:
    from app.core.nak_props import enthalpy_nak, entropy_nak, density_nak
    NAK_AVAILABLE = True
except ImportError:
    NAK_AVAILABLE = False
    enthalpy_nak = None
    entropy_nak = None
    density_nak = None

router = APIRouter(prefix="/solver", tags=["Equation Solver"])

# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────────────────────────────────────

class SolveRequest(BaseModel):
    script: str


class StepResult(BaseModel):
    line: int
    expr: str
    result: Any
    ok: bool
    msg: str


class SolveResponse(BaseModel):
    success: bool
    variables: dict[str, Any]
    execution_time_ms: float
    errors: list[str]
    warnings: list[str]
    steps: list[StepResult]


# ─────────────────────────────────────────────────────────────────────────────
# CoolProp property map
# ─────────────────────────────────────────────────────────────────────────────

OUTPUT_MAP: dict[str, str] = {
    "enthalpy":       "H",
    "h":              "H",
    "entropy":        "S",
    "s":              "S",
    "temperature":    "T",
    "t":              "T",
    "pressure":       "P",
    "p":              "P",
    "density":        "D",
    "d":              "D",
    "quality":        "Q",
    "x":              "Q",
    "internal_energy": "U",
    "u":              "U",
    "cp":             "C",
    "cv":             "O",
    "viscosity":      "VISCOSITY",
    "conductivity":   "CONDUCTIVITY",
    "speed_of_sound": "A",
    "a":              "A",
    "volume":         "V",   # handled specially (1/D)
    "v":              "V",
}

INPUT_NORM: dict[str, str] = {
    "t": "T", "p": "P", "h": "H", "s": "S",
    "q": "Q", "d": "D", "u": "U", "x": "Q", "v": "D",  # v → use D then invert
}


def _coolprop_lookup(func: str, fluid: str, kw: dict[str, float]) -> float:
    """
    Call CoolProp PropsSI with automatic kPa/kJ ↔ SI conversion.

    User-facing unit convention (TBS scripts):
      Pressure   → kPa       (internally multiplied ×1000 → Pa for CoolProp)
      Enthalpy   → kJ/kg     (internally multiplied ×1000 → J/kg)
      Entropy    → kJ/(kg·K) (internally multiplied ×1000 → J/(kg·K))
      Int. energy→ kJ/kg     (internally multiplied ×1000 → J/kg)
      Temperature→ K         (no conversion)
      Quality, Density, Volume → no conversion

    CoolProp outputs are divided back to display units before being
    returned to the script environment (so P results are kPa, h in kJ/kg, etc.)
    
    Special fluid names:
      'NaK(22_78)_liquid' → INCOMP::LiBr[0.22] (sodium-potassium eutectic)
    """
    if not COOLPROP_AVAILABLE:
        raise RuntimeError("CoolProp is not available on this server.")
    
    # Handle special incompressible fluids (NaK liquid metal)
    if 'NaK' in fluid and '_liquid' in fluid:
        if not NAK_AVAILABLE:
            raise RuntimeError("NaK correlations not available")
        T_val = kw.get('T') or kw.get('t')
        P_val = kw.get('P') or kw.get('p')
        func_lower = func.lower()
        out_key = OUTPUT_MAP.get(func_lower)
        if out_key == 'H':
            if T_val is None:
                raise ValueError("NaK enthalpy requires T= keyword")
            return enthalpy_nak(T_val, (P_val or 101.325) * 1000.0) / 1000.0  # J/kg → kJ/kg
        elif out_key == 'S':
            if T_val is None:
                raise ValueError("NaK entropy requires T= keyword")
            return entropy_nak(T_val) / 1000.0  # J/(kg·K) → kJ/(kg·K)
        elif out_key == 'D':
            if T_val is None:
                raise ValueError("NaK density requires T= keyword")
            return density_nak(T_val)  # kg/m³
        elif out_key == 'V':
            if T_val is None:
                raise ValueError("NaK volume requires T= keyword")
            return 1.0 / density_nak(T_val)  # m³/kg
        else:
            raise ValueError(f"Property '{func}' not supported for NaK liquid metal")

    out = OUTPUT_MAP.get(func.lower())
    if out is None:
        raise ValueError(f"Unknown property function '{func}'")
    if len(kw) != 2:
        raise ValueError(f"'{func}' needs exactly 2 known inputs, got {len(kw)}")

    # Keys that are energy-like (kJ → J) or pressure (kPa → Pa)
    _INPUT_SCALE: dict[str, float] = {
        "P": 1e3,   # kPa  → Pa
        "H": 1e3,   # kJ/kg → J/kg
        "S": 1e3,   # kJ/(kg·K) → J/(kg·K)
        "U": 1e3,   # kJ/kg → J/kg
    }
    _OUTPUT_SCALE: dict[str, float] = {
        "P": 1e-3,  # Pa      → kPa
        "H": 1e-3,  # J/kg    → kJ/kg
        "S": 1e-3,  # J/(kg·K)→ kJ/(kg·K)
        "U": 1e-3,  # J/kg    → kJ/kg
    }

    items = list(kw.items())
    k1 = INPUT_NORM.get(items[0][0].lower(), items[0][0].upper())
    k2 = INPUT_NORM.get(items[1][0].lower(), items[1][0].upper())
    v1 = items[0][1] * _INPUT_SCALE.get(k1, 1.0)
    v2 = items[1][1] * _INPUT_SCALE.get(k2, 1.0)

    if out == "V":
        raw = 1.0 / PropsSI("D", k1, v1, k2, v2, fluid)
        return raw  # m³/kg — no scale needed
    raw = PropsSI(out, k1, v1, k2, v2, fluid)
    return raw * _OUTPUT_SCALE.get(out, 1.0)


# ─────────────────────────────────────────────────────────────────────────────
# Regexes
# ─────────────────────────────────────────────────────────────────────────────

_RE_BLOCK_CMT  = re.compile(r'\{[^}]*\}')
_RE_STR_CMT    = re.compile(r'"[^"]*"')
# Unit annotations are expected as standalone brackets (typically after whitespace),
# not index operators attached to identifiers (e.g., h[4], P[21]).
_RE_UNIT_ANNOT = re.compile(r'(?<![A-Za-z0-9_])\[[^\]]*\]')
_RE_FLUID_ASSIGN = re.compile(r'''(\w+\$)\s*=\s*['"]([^'"]+)['"]''')
# CoolProp call: funcname(fluid$, k1=v1, k2=v2)
_RE_PROP_CALL = re.compile(
    r'([A-Za-z_]\w*)\s*\(\s*((?:\'[^\']*\'|"[^"]*"|[A-Za-z_]\w*\$?))\s*,\s*([^)]+)\)',
)
_RE_ASSIGN = re.compile(r'^([A-Za-z_]\w*\$?)\s*=\s*(.+)$', re.DOTALL)
_RE_INDEXED_VAR = re.compile(r'\b([A-Za-z_]\w*)\[(\d+)\]')

# ─────────────────────────────────────────────────────────────────────────────
# Evaluator
# ─────────────────────────────────────────────────────────────────────────────

_SAFE_BUILTINS: dict[str, Any] = {
    "sqrt": math.sqrt, "log": math.log, "log10": math.log10,
    "exp": math.exp, "abs": abs, "sin": math.sin, "cos": math.cos,
    "tan": math.tan, "asin": math.asin, "acos": math.acos,
    "atan": math.atan, "pi": math.pi, "e": math.e,
    "h_librh2o": h_librh2o if LIBRH2O_AVAILABLE else lambda t, x: 0.0,
    "s_librh2o": s_librh2o if LIBRH2O_AVAILABLE else lambda t, x: 0.0,
    "quality": lambda fluid, *args, **kwargs: 0.0,  # quality function for scripts
    "__builtins__": {},
}

_ALLOWED_AST_NODES = {
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Pow,
    ast.Mod,
    ast.FloorDiv,
    ast.USub,
    ast.UAdd,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
}


def _validate_expression_ast(expr: str, allowed_function_names: set[str]) -> None:
    """Reject unsafe Python syntax before evaluation."""
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"Invalid expression syntax: {exc.msg}") from exc

    for node in ast.walk(tree):
        if type(node) not in _ALLOWED_AST_NODES:
            raise ValueError(f"Unsupported expression construct: {type(node).__name__}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Only direct function calls are allowed")
            if node.func.id not in allowed_function_names:
                raise ValueError(f"Function '{node.func.id}' is not allowed")


def _eval_expr(expr: str, env: dict[str, Any]) -> Any:
    """
    Evaluate an arithmetic expression, resolving CoolProp calls first.
    """
    def _replace_prop(m: re.Match) -> str:
        func  = m.group(1)
        fvar  = m.group(2).strip()
        kw_str = m.group(3)

        # Only intercept thermophysical lookup function names.
        if func.lower() not in OUTPUT_MAP:
            return m.group(0)

        # Resolve fluid source: quoted literal, fluid$ variable, or bare literal.
        if (fvar.startswith("'") and fvar.endswith("'")) or (fvar.startswith('"') and fvar.endswith('"')):
            fluid = fvar[1:-1]
        elif fvar.endswith("$"):
            fluid = env.get(fvar)
            if fluid is None:
                raise NameError(f"Fluid variable '{fvar}' is not defined.")
        else:
            fluid = env.get(fvar, fvar)

        pairs: dict[str, float] = {}
        for part in re.split(r',(?![^(]*\))', kw_str):
            part = part.strip()
            if '=' not in part:
                continue
            k, v_tok = part.split('=', 1)
            pairs[k.strip()] = float(_eval_simple(v_tok.strip(), env))

        result = _coolprop_lookup(func, fluid, pairs)
        return repr(result)

    resolved = _RE_PROP_CALL.sub(_replace_prop, expr)
    _validate_expression_ast(resolved, {k for k in _SAFE_BUILTINS.keys() if k != "__builtins__"})

    # Build namespace from numeric env vars + math helpers
    ns = {k: v for k, v in env.items()
          if isinstance(v, (int, float)) and not k.endswith('$')}
    ns.update(_SAFE_BUILTINS)

    return eval(compile(resolved, '<tb>', 'eval'), {"__builtins__": {}}, ns)  # noqa: S307


def _eval_simple(tok: str, env: dict[str, Any]) -> Any:
    """Resolve a single token — either a literal number or a variable."""
    try:
        return float(tok)
    except ValueError:
        pass
    if tok in env:
        return env[tok]
    return _eval_expr(tok, env)


def _strip(line: str) -> str:
    line = _RE_BLOCK_CMT.sub('', line)
    line = _RE_STR_CMT.sub('', line)
    line = _RE_UNIT_ANNOT.sub('', line)
    return line.strip()


def _normalize_indexed_vars(text: str) -> str:
    """
    Convert EES-style indexed symbols to identifier-safe names.

    Example:
      h[4] -> h_4
      P[21] -> P_21
    """
    return _RE_INDEXED_VAR.sub(r'\1_\2', text)


# ─────────────────────────────────────────────────────────────────────────────
# Main solver
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_script(script: str) -> SolveResponse:
    t0 = time.perf_counter()
    env: dict[str, Any] = {}
    errors: list[str] = []
    warnings: list[str] = []
    steps: list[StepResult] = []

    for lineno, raw in enumerate(script.splitlines(), start=1):
        clean = _normalize_indexed_vars(_strip(raw))
        if not clean:
            continue

        # Fluid string shorthand:  Fluid$ = 'R245fa'
        fm = _RE_FLUID_ASSIGN.match(clean)
        if fm:
            var, val = fm.group(1), fm.group(2)
            env[var] = val
            steps.append(StepResult(line=lineno, expr=raw.strip(), result=val, ok=True, msg=""))
            continue

        # General assignment
        am = _RE_ASSIGN.match(clean)
        if not am:
            if clean:
                warnings.append(f"Line {lineno}: skipped (not an assignment): '{clean[:80]}'")
            continue

        lhs, rhs = am.group(1), am.group(2).strip()
        try:
            val = _eval_expr(rhs, env)
            env[lhs] = val
            disp = round(float(val), 9) if isinstance(val, float) else val
            steps.append(StepResult(line=lineno, expr=raw.strip(), result=disp, ok=True, msg=""))
        except Exception as exc:
            msg = str(exc)
            errors.append(f"Line {lineno}: {msg}")
            steps.append(StepResult(line=lineno, expr=raw.strip(), result=None, ok=False, msg=msg))

    # Build serialisable variable dict
    variables: dict[str, Any] = {}
    for k, v in env.items():
        try:
            variables[k] = round(float(v), 8) if isinstance(v, float) else v
        except Exception:
            variables[k] = str(v)

    ms = round((time.perf_counter() - t0) * 1000, 2)
    return SolveResponse(
        success=len(errors) == 0,
        variables=variables,
        execution_time_ms=ms,
        errors=errors,
        warnings=warnings,
        steps=steps,
    )


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/solve", response_model=SolveResponse)
async def solve_equations(
    body: SolveRequest,
    user=Depends(get_current_user),
):
    """Evaluate a ThermoBird Script and return all computed variables."""
    if len(body.script) > 100_000:
        raise HTTPException(status_code=422, detail="Script exceeds 100 000 character limit.")

    return evaluate_script(body.script)
