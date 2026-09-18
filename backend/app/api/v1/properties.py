"""
ThermoBird — Properties API Router (V1 parity)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.redis_client import get_redis, get_cached_properties, cache_properties

from CoolProp.CoolProp import PropsSI, PhaseSI
from app.core.diagram_engine import generate_diagrams

router = APIRouter(prefix="/properties", tags=["Properties"])

# ── Supported fluids ──────────────────────────────────────────────────────────
# Dynamically pull every fluid CoolProp knows about, sorted alphabetically.
# Mixtures (e.g. R410A) are included via the MIXTURES list; CoolProp's
# FluidsList() returns only the pure-fluid back-end names.
try:
    from CoolProp.CoolProp import FluidsList as _FL
    PURE_FLUIDS: list = sorted(_FL())
except Exception:
    PURE_FLUIDS = ["Water", "R134a", "Ammonia", "CO2", "Air", "Nitrogen"]

VALID_PROPS = {"T", "P", "H", "S", "Q", "D", "U"}


class DiagramRequest(BaseModel):
    fluid: str
    T: float   # K
    P: float   # Pa
    H: float   # J/kg
    S: float   # J/kg.K


class PropertyCalcRequest(BaseModel):
    fluid: str
    input1_type: str
    input1_value: float
    input2_type: str
    input2_value: float
    unit_system: str = "SI"  # "SI" or "Imperial"


@router.get("/fluids")
async def list_fluids():
    return {"fluids": PURE_FLUIDS}


@router.post("/diagrams")
async def get_diagrams(
    body: DiagramRequest,
):
    """Generate T-s and P-h diagrams with state point marked."""
    try:
        charts = generate_diagrams(
            fluid=body.fluid,
            state={"T": body.T, "P": body.P, "H": body.H, "S": body.S},
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Diagram error: {e}")

    return charts


@router.get("/pairs")
async def list_input_pairs():
    pairs = [
        ("P", "T"), ("P", "H"), ("P", "S"), ("P", "Q"), ("P", "D"),
        ("T", "Q"), ("T", "S"), ("T", "H"), ("H", "S"), ("P", "U"),
    ]
    return {"pairs": pairs}


@router.post("/calculate")
async def calculate_properties(
    body: PropertyCalcRequest,
):
    fluid = body.fluid
    p1, v1 = body.input1_type.upper(), body.input1_value
    p2, v2 = body.input2_type.upper(), body.input2_value

    if p1 == p2:
        raise HTTPException(status_code=422, detail="Input properties must be different.")

    redis = await get_redis()
    cache_key = f"{p1}_{p2}"
    cached = await get_cached_properties(redis, fluid, cache_key, v1, v2, body.unit_system)
    if cached:
        return cached

    try:
        def ps(*args):
            return PropsSI(*args, fluid)

        T  = ps("T",  p1, v1, p2, v2)
        P  = ps("P",  p1, v1, p2, v2)
        H  = ps("H",  p1, v1, p2, v2)
        S  = ps("S",  p1, v1, p2, v2)
        U  = ps("U",  p1, v1, p2, v2)
        D  = ps("D",  p1, v1, p2, v2)
        Cp = ps("C",  p1, v1, p2, v2)
        Cv = ps("O",  p1, v1, p2, v2)
        A  = ps("A",  p1, v1, p2, v2)
        Z  = ps("Z",  p1, v1, p2, v2)
        M  = PropsSI("M", fluid)

        try:
            Q = ps("Q", p1, v1, p2, v2)
            Q = Q if 0 <= Q <= 1 else None
        except Exception:
            Q = None

        try:
            visc = ps("VISCOSITY", p1, v1, p2, v2)
        except Exception:
            visc = None
        try:
            cond = ps("CONDUCTIVITY", p1, v1, p2, v2)
        except Exception:
            cond = None

        Pr = (Cp * visc / cond) if (visc and cond and cond != 0) else None
        V  = 1.0 / D if D else None

        phase = PhaseSI("T", T, "P", P, fluid)

        # Saturation properties at same T and P
        try:
            T_sat = PropsSI("T", "Q", 0, "P", P, fluid)
            P_sat = PropsSI("P", "Q", 0, "T", T, fluid)
            hf    = PropsSI("H", "T", T_sat, "Q", 0, fluid)
            hg    = PropsSI("H", "T", T_sat, "Q", 1, fluid)
            sf    = PropsSI("S", "T", T_sat, "Q", 0, fluid)
            sg    = PropsSI("S", "T", T_sat, "Q", 1, fluid)
        except Exception:
            T_sat = P_sat = hf = hg = sf = sg = None

        Tcrit  = PropsSI("Tcrit",   fluid)
        Pcrit  = PropsSI("Pcrit",   fluid)
        Ttrip  = PropsSI("Ttriple", fluid)
        Ptrip  = PropsSI("ptriple", fluid)

        result = {
            # Primary state
            "T": T, "P": P, "H": H, "S": S, "U": U,
            "D": D, "V": V,
            # Caloric
            "Cp": Cp, "Cv": Cv,
            # Transport
            "viscosity": visc, "conductivity": cond, "Pr": Pr,
            # Other
            "Z": Z, "M": M, "A": A,
            "quality": Q, "phase": phase,
            # Critical / triple
            "Tcrit": Tcrit, "Pcrit": Pcrit,
            "Ttriple": Ttrip, "Ptriple": Ptrip,
            # Saturation
            "T_sat": T_sat, "P_sat": P_sat,
            "hf": hf, "hg": hg, "sf": sf, "sg": sg,
        }

    except Exception as e:
        raise HTTPException(status_code=422, detail=f"CoolProp error: {e}")

    await cache_properties(redis, fluid, cache_key, v1, v2, body.unit_system, result)
    return result
