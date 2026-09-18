"""
ThermoBird — Thermodynamic Diagram Generator  (diagram_engine.py)

T-s Diagram  (temperature–entropy)
────────────────────────────────────
  • Saturation dome (liquid-side sky-blue, vapour-side orange), shaded two-phase region
  • Isobars (const. P lines)  — run BELOW / through the dome:
      - Inside two-phase region they are horizontal (T_sat = f(P))
      - In subcooled liquid they curve steeply upward to the left
      - In superheated region they curve upward to the right
  • Isotherms (const. T) — only drawn ABOVE the dome (superheated region)
      - Appear as nearly horizontal slightly sloped lines above the dome
  • Isochores (const. specific volume) — steep lines going toward the
      upper-right edge (superheated + subcooled regions)
  NOTE: do NOT draw isotherms inside the two-phase region — they coincide
        with isobars there (T=const = T_sat, P=const = P_sat), which is
        physically correct but visually redundant/cluttered.

P-h Diagram  (pressure–enthalpy, log-P scale)
──────────────────────────────────────────────
  • Saturation dome, shaded two-phase region
  • Isotherms (const. T):
      - Subcooled region  → nearly vertical lines (h changes little with P at const T)
      - Two-phase region  → horizontal lines at P_sat(T)  ← already visible as dome
      - Superheated region → sloping lines (h increases with T at const P)
  • Isentropes (const. s) in the SUPERHEATED region only:
      - Steep curves emanating from the vapour saturation curve upward-right
  • Isobars in P-h are just horizontal lines — not drawn (trivial / same as grid)

Returns base64 PNG strings.
"""
import io
import base64
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker
from CoolProp.CoolProp import PropsSI

# ── Design tokens ─────────────────────────────────────────────────────────────
BG        = "#0f172a"
SURFACE   = "#1e293b"
BORDER    = "#334155"
DOME_LIQ  = "#38bdf8"   # sky blue — saturated liquid branch
DOME_VAP  = "#f97316"   # orange   — saturated vapour branch
FILL      = "#0ea5e9"   # two-phase fill tint
ISOBAR    = "#475569"   # muted blue-gray — isobars on T-s
ISOCHORE  = "#22d3ee"   # cyan dashed — isochores on T-s
ISOTHERM  = "#818cf8"   # indigo — isotherms
ISENTROPE = "#34d399"   # emerald — isentropes
STATE_CLR = "#facc15"   # yellow star — single state point
TEXT_CLR  = "#94a3b8"
CRIT_CLR  = "#a78bfa"
ISO_LBL   = "#64748b"


# ─────────────────────────────────────────────────────────────────────────────
# Saturation dome data
# ─────────────────────────────────────────────────────────────────────────────

def _dome_data(fluid: str, n: int = 400) -> dict:
    T_trip = PropsSI("Ttriple", fluid)
    T_crit = PropsSI("Tcrit",   fluid)
    P_crit = PropsSI("Pcrit",   fluid)

    # Build from triple-point to just below critical
    T_arr = np.linspace(T_trip * 1.001, T_crit * 0.9999, n)
    h_liq, h_vap = [], []
    s_liq, s_vap = [], []
    P_arr, T_good = [], []

    for T in T_arr:
        try:
            hl = PropsSI("H", "T", T, "Q", 0, fluid)
            hv = PropsSI("H", "T", T, "Q", 1, fluid)
            sl = PropsSI("S", "T", T, "Q", 0, fluid)
            sv = PropsSI("S", "T", T, "Q", 1, fluid)
            P  = PropsSI("P", "T", T, "Q", 0, fluid)
            h_liq.append(hl); h_vap.append(hv)
            s_liq.append(sl); s_vap.append(sv)
            P_arr.append(P);  T_good.append(T)
        except Exception:
            continue

    T_crit_h = PropsSI("H", "T", T_crit, "Q", 0.5, fluid)
    T_crit_s = PropsSI("S", "T", T_crit, "Q", 0.5, fluid)

    return {
        "T":      np.array(T_good),
        "P_kpa":  np.array(P_arr)  / 1e3,
        "h_liq":  np.array(h_liq)  / 1e3,
        "h_vap":  np.array(h_vap)  / 1e3,
        "s_liq":  np.array(s_liq)  / 1e3,
        "s_vap":  np.array(s_vap)  / 1e3,
        "T_crit": T_crit,
        "T_trip": T_trip,
        "P_crit": P_crit / 1e3,
        "h_crit": T_crit_h / 1e3,
        "s_crit": T_crit_s / 1e3,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Axis styling
# ─────────────────────────────────────────────────────────────────────────────

def _style_axes(ax, title: str, xlabel: str, ylabel: str):
    ax.set_facecolor(BG)
    ax.set_title(title, color=TEXT_CLR, fontsize=10, fontweight="bold", pad=8)
    ax.set_xlabel(xlabel, color=TEXT_CLR, fontsize=8)
    ax.set_ylabel(ylabel, color=TEXT_CLR, fontsize=8)
    ax.tick_params(colors=TEXT_CLR, labelsize=7)
    for spine in ax.spines.values():
        spine.set_edgecolor(BORDER)
    ax.grid(True, color=BORDER, linewidth=0.4, linestyle="--", alpha=0.5)


# ─────────────────────────────────────────────────────────────────────────────
# T-s iso-lines
# ─────────────────────────────────────────────────────────────────────────────

def _isobars_ts(ax, fluid: str, dome: dict, n_bars: int = 8):
    """
    Isobars on T-s diagram.

    Thermodynamic behaviour:
    ─────────────────────────
    • Subcooled liquid  : very steep, nearly vertical, clustered near left side of dome
    • Two-phase region  : HORIZONTAL lines (T_sat is constant at fixed P)
                         These connect the liquid saturation line to the vapour line
    • Superheated vapour: gentle positive slope curving to the right and up

    Implementation: for each pressure P, sample T from just above T_triple to
    T_hi, skipping any point that CoolProp refuses.  The two-phase segment is
    automatically captured because CoolProp returns the saturation T when we
    fix P and Q.
    """
    T_trip = dome["T_trip"]
    T_crit = dome["T_crit"]
    P_crit_Pa = dome["P_crit"] * 1e3

    # Pressure range: from ~5% of P_trip to 150% of P_crit
    P_trip_Pa = PropsSI("P", "T", T_trip * 1.001, "Q", 0, fluid)
    P_lo = max(P_trip_Pa * 1.5, 1e3)
    P_hi = P_crit_Pa * 1.5
    pressures = np.geomspace(P_lo, P_hi, n_bars)

    T_lo = T_trip * 0.98
    T_hi = T_crit * 1.75

    for P in pressures:
        # Skip pressures above critical — no phase transition, just supercritical
        T_pts, s_pts = [], []
        # Sample the entire T range — subcooled + two-phase (CoolProp handles Q internally) + superheated
        for T in np.linspace(T_lo, T_hi, 200):
            try:
                # Let CoolProp pick the right phase
                s = PropsSI("S", "P", P, "T", T, fluid) / 1e3
                if np.isfinite(s):
                    T_pts.append(T)
                    s_pts.append(s)
            except Exception:
                pass

        if len(T_pts) < 4:
            continue

        T_arr_np = np.array(T_pts)
        s_arr_np = np.array(s_pts)

        # Remove outliers (discontinuities at phase boundaries can cause spikes)
        ds = np.abs(np.diff(s_arr_np))
        ds_median = np.median(ds)
        valid = np.concatenate([[True], ds < ds_median * 20])
        T_arr_np = T_arr_np[valid]
        s_arr_np = s_arr_np[valid]

        if len(T_arr_np) < 4:
            continue

        ax.plot(s_arr_np, T_arr_np, color=ISOBAR, lw=0.7, alpha=0.75, zorder=1)

        # Label near the superheated end (right side of diagram)
        idx = min(len(T_arr_np) - 1, int(len(T_arr_np) * 0.85))
        lbl = f"{P/1e3:.0f} kPa" if P < 1e6 else f"{P/1e6:.2g} MPa"
        ax.annotate(lbl, (s_arr_np[idx], T_arr_np[idx]),
                    fontsize=5, color=ISO_LBL, ha="center", va="bottom",
                    xytext=(0, 3), textcoords="offset points", zorder=2)


def _isotherms_ts_superheated(ax, fluid: str, dome: dict, n_therms: int = 5):
    """
    Isotherms in the SUPERHEATED region only on T-s.

    In the superheated region, isotherms are horizontal lines (T = const).
    On a T-s diagram a horizontal line is of course just a flat horizontal band.
    They are only meaningful above the dome, so we draw them there.
    They show how entropy changes at a constant temperature (dh = T·ds at const P),
    which is useful for visualising heat addition/rejection at constant T.

    We only draw above T_crit to avoid confusion with the two-phase region.
    """
    T_crit = dome["T_crit"]
    T_hi   = T_crit * 1.7

    # Only above dome
    temps = np.linspace(T_crit * 1.02, T_hi, n_therms)

    # Entropy range for superheated — from near s_vap(T_crit) outward
    s_min_ref = dome["s_crit"] * 1e3
    s_max_ref = dome["s_vap"].max() * 1e3 * 1.4

    P_crit_Pa = dome["P_crit"] * 1e3
    P_lo = 5e3        # 5 kPa
    P_hi = P_crit_Pa * 5.0

    for T in temps:
        s_pts = []
        for P in np.geomspace(P_lo, P_hi, 80):
            try:
                ph = PropsSI("phase", "P", P, "T", T, fluid)
                # Only superheated (ph == 2) or gas
                if ph not in (2, 5, 6):
                    continue
                s = PropsSI("S", "P", P, "T", T, fluid) / 1e3
                if np.isfinite(s) and s > 0:
                    s_pts.append(s)
            except Exception:
                pass

        if len(s_pts) < 3:
            continue

        s_arr = np.array(sorted(s_pts))
        T_arr = np.full_like(s_arr, T)

        ax.plot(s_arr, T_arr, color=ISOTHERM, lw=0.55, alpha=0.5,
                linestyle=(0, (4, 3)), zorder=1)


def _isochores_ts(ax, fluid: str, dome: dict, n_lines: int = 5):
    """
    Isochores (constant specific volume) on T-s.

    Thermodynamic character on T-s:
    • In superheated vapour region: steep, positively-sloped lines toward upper-right
    • In subcooled liquid: also steep but with a very different curvature

    We draw them across the full T range, skipping the two-phase region
    (where v is not a single-valued function of T alone).
    """
    T_crit = dome["T_crit"]
    T_trip = dome["T_trip"]

    # Span from very dense (subcooled liquid v) to very dilute (superheated v)
    rho_crit = PropsSI("D", "T", T_crit, "Q", 0.5, fluid)
    v_crit   = 1.0 / rho_crit

    # Cover subcooled (small v) to superheated (large v)
    v_vals = np.geomspace(v_crit * 0.04, v_crit * 120, n_lines)

    T_range = np.linspace(T_trip * 0.98, T_crit * 1.8, 180)

    for v in v_vals:
        rho = 1.0 / v
        T_pts, s_pts = [], []
        for T in T_range:
            try:
                # CoolProp: specify density + temperature
                ph = PropsSI("phase", "D", rho, "T", T, fluid)
                # Skip two-phase (ph==6 in CoolProp enum) to avoid messy crossing
                if ph == 6:
                    continue
                s = PropsSI("S", "D", rho, "T", T, fluid) / 1e3
                if np.isfinite(s):
                    T_pts.append(T)
                    s_pts.append(s)
            except Exception:
                pass

        if len(T_pts) < 4:
            continue

        ax.plot(s_pts, T_pts, color=ISOCHORE, lw=0.5, alpha=0.40,
                linestyle=":", zorder=1)


# ─────────────────────────────────────────────────────────────────────────────
# P-h iso-lines
# ─────────────────────────────────────────────────────────────────────────────

def _isotherms_ph(ax, fluid: str, dome: dict, n_therms: int = 9):
    """
    Isotherms on P-h (log-P scale).

    Thermodynamic behaviour:
    ─────────────────────────
    • Subcooled liquid  : nearly VERTICAL lines (h barely changes with P at const T;
                         enthalpy of liquids is almost independent of pressure)
    • Two-phase region  : HORIZONTAL lines at P_sat(T) — the isotherm = isobar there.
                         We skip drawing these explicitly (the dome handles it).
    • Superheated vapour: gently sloping curves, h increases with decreasing P at const T
                         (ideal gas: h independent of P, real gas: slight slope)
    • Supercritical     : smooth continuation above critical point
    """
    T_crit = dome["T_crit"]
    T_trip = dome["T_trip"]

    T_lo = T_trip * 1.05
    T_hi = T_crit * 1.8
    temps = np.linspace(T_lo, T_hi, n_therms)

    P_crit_Pa = dome["P_crit"] * 1e3
    P_lo_Pa = max(PropsSI("P", "T", T_trip * 1.001, "Q", 0, fluid) * 0.3, 1e3)
    P_hi_Pa = P_crit_Pa * 6.0

    for T in temps:
        h_pts_sub, P_pts_sub = [], []   # subcooled segment
        h_pts_sup, P_pts_sup = [], []   # superheated/supercritical segment

        for P in np.geomspace(P_lo_Pa, P_hi_Pa, 160):
            try:
                ph = PropsSI("phase", "P", P, "T", T, fluid)
                h = PropsSI("H", "P", P, "T", T, fluid) / 1e3
                P_kpa = P / 1e3
                if not np.isfinite(h):
                    continue
                # Subcooled liquid (ph == 3 in CoolProp)
                if ph == 3:
                    h_pts_sub.append(h); P_pts_sub.append(P_kpa)
                # Superheated (ph == 2) or supercritical (ph == 5, 6+)
                elif ph in (2, 5, 8):
                    h_pts_sup.append(h); P_pts_sup.append(P_kpa)
            except Exception:
                pass

        # Draw subcooled segment (nearly vertical)
        if len(h_pts_sub) >= 3:
            ax.plot(h_pts_sub, P_pts_sub, color=ISOTHERM, lw=0.65, alpha=0.65, zorder=1)
            # Label at low-pressure end
            ax.annotate(f"{T - 273.15:.0f}°C",
                        (h_pts_sub[0], P_pts_sub[0]),
                        fontsize=5, color=ISO_LBL, ha="right", va="center",
                        xytext=(-3, 0), textcoords="offset points", zorder=2)

        # Draw superheated segment
        if len(h_pts_sup) >= 3:
            ax.plot(h_pts_sup, P_pts_sup, color=ISOTHERM, lw=0.65, alpha=0.65, zorder=1)
            # Label at high-h end
            ax.annotate(f"{T - 273.15:.0f}°C",
                        (h_pts_sup[-1], P_pts_sup[-1]),
                        fontsize=5, color=ISO_LBL, ha="left", va="center",
                        xytext=(3, 0), textcoords="offset points", zorder=2)


def _isentropes_ph(ax, fluid: str, dome: dict, n_lines: int = 7):
    """
    Isentropes (constant entropy) on P-h in the SUPERHEATED region.

    These are the most important lines in refrigeration P-h diagrams:
    they represent the ideal (isentropic) compression path of a compressor.

    Thermodynamic character on P-h:
    • In the superheated region: steep curves rising to the upper right
    • The slope (∂P/∂h)_s = ρ/[1 + (∂ln v/∂ln T)_P · T·c_p / (c_p - R)]
      In practice: roughly linear in log-P scale, steeper than isotherms

    We sample from just above the saturation vapour curve.
    """
    T_crit = dome["T_crit"]
    T_trip = dome["T_trip"]
    P_crit_Pa = dome["P_crit"] * 1e3

    # Sample entropy values along the saturated vapour curve at evenly-spaced T
    T_sample_pts = np.linspace(T_trip * 1.05, T_crit * 0.98, n_lines + 2)[1:-1]
    s_vals = []
    for T in T_sample_pts:
        try:
            sv = PropsSI("S", "T", T, "Q", 1, fluid)
            if np.isfinite(sv):
                s_vals.append(sv)
        except Exception:
            pass

    if not s_vals:
        return

    P_lo_Pa = max(PropsSI("P", "T", T_trip * 1.001, "Q", 0, fluid) * 0.2, 500.0)
    P_hi_Pa = P_crit_Pa * 6.0

    for s in s_vals:
        h_pts, P_pts = [], []
        for P in np.geomspace(P_lo_Pa, P_hi_Pa, 140):
            try:
                ph = PropsSI("phase", "P", P, "S", s, fluid)
                # Only superheated or supercritical
                if ph not in (2, 5, 8):
                    continue
                h = PropsSI("H", "P", P, "S", s, fluid) / 1e3
                if np.isfinite(h):
                    h_pts.append(h)
                    P_pts.append(P / 1e3)
            except Exception:
                pass

        if len(h_pts) >= 4:
            ax.plot(h_pts, P_pts, color=ISENTROPE, lw=0.6, alpha=0.45,
                    linestyle=(0, (5, 2)), zorder=1)


# ─────────────────────────────────────────────────────────────────────────────
# Build T-s diagram
# ─────────────────────────────────────────────────────────────────────────────

def build_ts_diagram(fluid: str, dome: dict, state: dict) -> str:
    fig, ax = plt.subplots(figsize=(5.8, 4.2), facecolor=BG)
    _style_axes(ax, f"T-s  —  {fluid}",
                "Specific Entropy  s  [kJ/(kg·K)]", "Temperature  T  [K]")

    # ── Two-phase fill ────────────────────────────────────────────────────────
    s_fill = np.concatenate([dome["s_liq"], dome["s_vap"][::-1]])
    T_fill = np.concatenate([dome["T"],     dome["T"][::-1]])
    ax.fill(s_fill, T_fill, color=FILL, alpha=0.07, zorder=0)

    # ── Iso-lines ─────────────────────────────────────────────────────────────
    # Draw in order: isochores first (background), then isobars, then isotherms
    _isochores_ts(ax, fluid, dome, n_lines=5)
    _isobars_ts(ax, fluid, dome, n_bars=8)
    _isotherms_ts_superheated(ax, fluid, dome, n_therms=4)

    # ── Saturation dome ───────────────────────────────────────────────────────
    ax.plot(dome["s_liq"], dome["T"], color=DOME_LIQ, lw=2.0,
            label="Sat. Liquid (Q=0)", zorder=4)
    ax.plot(dome["s_vap"], dome["T"], color=DOME_VAP, lw=2.0,
            label="Sat. Vapour (Q=1)", zorder=4)

    # ── Critical point ────────────────────────────────────────────────────────
    ax.scatter([dome["s_crit"]], [dome["T_crit"]],
               color=CRIT_CLR, s=60, zorder=6, marker="D", label="Critical Point")

    # ── State point ───────────────────────────────────────────────────────────
    s_st = state["S"] / 1e3
    T_st = state["T"]
    ax.scatter([s_st], [T_st], color=STATE_CLR, s=140, zorder=7, marker="*", label="State")
    ax.annotate(f" T={T_st:.1f} K\n s={s_st:.3f} kJ/kg·K",
                xy=(s_st, T_st), color=STATE_CLR, fontsize=7,
                bbox=dict(boxstyle="round,pad=0.25", fc=SURFACE, ec=STATE_CLR, alpha=0.9),
                zorder=8)

    # ── Legend & layout ───────────────────────────────────────────────────────
    leg = ax.legend(fontsize=6.5, facecolor=SURFACE, edgecolor=BORDER,
                    labelcolor=TEXT_CLR, loc="upper left", framealpha=0.9)
    fig.tight_layout(pad=1.0)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, facecolor=BG, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


# ─────────────────────────────────────────────────────────────────────────────
# Build P-h diagram
# ─────────────────────────────────────────────────────────────────────────────

def build_ph_diagram(fluid: str, dome: dict, state: dict) -> str:
    fig, ax = plt.subplots(figsize=(5.8, 4.2), facecolor=BG)
    _style_axes(ax, f"P-h  —  {fluid}",
                "Specific Enthalpy  h  [kJ/kg]", "Pressure  P  [kPa]")

    P_kpa = dome["P_kpa"]

    # ── Two-phase fill ────────────────────────────────────────────────────────
    h_fill = np.concatenate([dome["h_liq"], dome["h_vap"][::-1]])
    P_fill = np.concatenate([P_kpa,          P_kpa[::-1]])
    ax.fill(h_fill, P_fill, color=FILL, alpha=0.07, zorder=0)

    # ── Iso-lines ─────────────────────────────────────────────────────────────
    _isotherms_ph(ax, fluid, dome, n_therms=9)
    _isentropes_ph(ax, fluid, dome, n_lines=7)

    # ── Saturation dome ───────────────────────────────────────────────────────
    ax.plot(dome["h_liq"], P_kpa, color=DOME_LIQ, lw=2.0,
            label="Sat. Liquid (Q=0)", zorder=4)
    ax.plot(dome["h_vap"], P_kpa, color=DOME_VAP, lw=2.0,
            label="Sat. Vapour (Q=1)", zorder=4)

    # ── Critical point ────────────────────────────────────────────────────────
    ax.scatter([dome["h_crit"]], [dome["P_crit"]],
               color=CRIT_CLR, s=60, zorder=6, marker="D", label="Critical Point")

    # ── State point ───────────────────────────────────────────────────────────
    h_st = state["H"] / 1e3
    P_st = state["P"] / 1e3
    ax.scatter([h_st], [P_st], color=STATE_CLR, s=140, zorder=7, marker="*", label="State")
    ax.annotate(f" P={P_st:.1f} kPa\n h={h_st:.1f} kJ/kg",
                xy=(h_st, P_st), color=STATE_CLR, fontsize=7,
                bbox=dict(boxstyle="round,pad=0.25", fc=SURFACE, ec=STATE_CLR, alpha=0.9),
                zorder=8)

    # ── Log-P axis ────────────────────────────────────────────────────────────
    ax.set_yscale("log")
    P_lo = max(P_kpa[0] * 0.35, 1e-2)
    P_hi = dome["P_crit"] * 6.5
    ax.set_ylim(P_lo, P_hi)

    exp_lo = int(np.floor(np.log10(max(P_lo, 1e-6))))
    exp_hi = int(np.ceil(np.log10(P_hi)))
    major_ticks = [10**e for e in range(exp_lo, exp_hi + 1) if P_lo <= 10**e <= P_hi]
    ax.set_yticks(major_ticks)

    def _fmt_p(val, _):
        if val >= 1000:
            return f"{val / 1000:.4g} MPa"
        return f"{val:.4g} kPa"

    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(_fmt_p))
    ax.yaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())

    # ── Legend & layout ───────────────────────────────────────────────────────
    ax.legend(fontsize=6.5, facecolor=SURFACE, edgecolor=BORDER,
              labelcolor=TEXT_CLR, loc="upper left", framealpha=0.9)
    fig.tight_layout(pad=1.0)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, facecolor=BG, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def generate_diagrams(fluid: str, state: dict) -> dict:
    dome = _dome_data(fluid)
    return {
        "ts": build_ts_diagram(fluid, dome, state),
        "ph": build_ph_diagram(fluid, dome, state),
    }
