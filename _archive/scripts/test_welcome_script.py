"""
Standalone test — no SQLAlchemy needed.
Directly imports only the pure-Python evaluate_script function.
"""
import sys, os, re, math, time
from typing import Any

# ── Minimal duplicate of equation_solver internals ───────────────────────────
try:
    from CoolProp.CoolProp import PropsSI
    COOLPROP_AVAILABLE = True
except ImportError:
    COOLPROP_AVAILABLE = False

OUTPUT_MAP = {
    "enthalpy":"H","h":"H","entropy":"S","s":"S","temperature":"T","t":"T",
    "pressure":"P","p":"P","density":"D","d":"D","quality":"Q","x":"Q",
    "internal_energy":"U","u":"U","cp":"C","cv":"O","viscosity":"VISCOSITY",
    "conductivity":"CONDUCTIVITY","speed_of_sound":"A","a":"A","volume":"V","v":"V",
}
INPUT_NORM = {"t":"T","p":"P","h":"H","s":"S","q":"Q","d":"D","u":"U","x":"Q","v":"D"}

def _coolprop(func, fluid, kw):
    out = OUTPUT_MAP.get(func.lower())
    items = list(kw.items())
    k1 = INPUT_NORM.get(items[0][0].lower(), items[0][0].upper())
    k2 = INPUT_NORM.get(items[1][0].lower(), items[1][0].upper())
    v1, v2 = items[0][1], items[1][1]
    if out == "V":
        return 1.0 / PropsSI("D", k1, v1, k2, v2, fluid)
    return PropsSI(out, k1, v1, k2, v2, fluid)

_RE_BLOCK  = re.compile(r'\{[^}]*\}')
_RE_STR    = re.compile(r'"[^"]*"')
_RE_UNIT   = re.compile(r'\[[^\]]*\]')
_RE_FLUID  = re.compile(r'''(\w+\$)\s*=\s*['"]([^'"]+)['"]''')
_RE_PROP   = re.compile(r'([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*\$)\s*,\s*([^)]+)\)')
_RE_ASSIGN = re.compile(r'^([A-Za-z_]\w*\$?)\s*=\s*(.+)$', re.DOTALL)

_SAFE = {"sqrt":math.sqrt,"log":math.log,"log10":math.log10,"exp":math.exp,
         "abs":abs,"sin":math.sin,"cos":math.cos,"tan":math.tan,
         "asin":math.asin,"acos":math.acos,"atan":math.atan,"pi":math.pi,"e":math.e,
         "__builtins__":{}}

def _eval(expr, env):
    def repl(m):
        func, fvar, kw_str = m.group(1), m.group(2), m.group(3)
        fluid = env.get(fvar)
        pairs = {}
        for part in re.split(r',(?![^(]*\))', kw_str):
            part = part.strip()
            if '=' not in part: continue
            k, v = part.split('=', 1)
            pairs[k.strip()] = float(_eval(v.strip(), env))
        return repr(_coolprop(func, fluid, pairs))
    resolved = _RE_PROP.sub(repl, expr)
    ns = {k: v for k, v in env.items() if isinstance(v, (int, float)) and not k.endswith('$')}
    ns.update(_SAFE)
    return eval(compile(resolved, '<tb>', 'eval'), {"__builtins__": {}}, ns)

def run(script):
    env = {}; errors = []
    for lineno, raw in enumerate(script.splitlines(), 1):
        clean = _RE_UNIT.sub('', _RE_STR.sub('', _RE_BLOCK.sub('', raw))).strip()
        if not clean: continue
        fm = _RE_FLUID.match(clean)
        if fm:
            env[fm.group(1)] = fm.group(2); continue
        am = _RE_ASSIGN.match(clean)
        if not am: continue
        lhs, rhs = am.group(1), am.group(2).strip()
        try:
            env[lhs] = _eval(rhs, env)
        except Exception as exc:
            errors.append(f"Line {lineno}: {exc}")
    return env, errors

# ── Test the welcome script ───────────────────────────────────────────────────
SCRIPT = """
WorkingFluid$ = 'Water'
P_cond  = 10000
P_boil  = 3000000
eta_pump    = 0.80
eta_turbine = 0.85
P1 = P_cond
x1 = 0
h1 = enthalpy(WorkingFluid$, P=P1, x=x1)
s1 = entropy(WorkingFluid$, P=P1, x=x1)
v1 = volume(WorkingFluid$, P=P1, x=x1)
P2  = P_boil
h2s = h1 + v1 * (P2 - P1)
h2  = h1 + (h2s - h1) / eta_pump
P3 = P_boil
T3 = 623.15
h3 = enthalpy(WorkingFluid$, P=P3, T=T3)
s3 = entropy(WorkingFluid$, P=P3, T=T3)
P4  = P_cond
h4s = enthalpy(WorkingFluid$, P=P4, s=s3)
h4  = h3 - eta_turbine * (h3 - h4s)
W_turbine = h3 - h4
W_pump    = h2 - h1
Q_in      = h3 - h2
W_net     = W_turbine - W_pump
eta_cycle = W_net / Q_in
COP_ref   = Q_in / W_net
"""

env, errs = run(SCRIPT)
print("CoolProp available:", COOLPROP_AVAILABLE)
print("Errors:", errs if errs else "None")
for k in ["h1","h2","h3","h4","h4s","W_turbine","W_pump","Q_in","W_net","eta_cycle"]:
    v = env.get(k)
    print(f"  {k:12s} = {v:.4f}" if isinstance(v, float) else f"  {k:12s} = {v}")
