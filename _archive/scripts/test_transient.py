"""Quick transient solver test — run from backend/ with: python test_transient.py"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.core.transient.ode_solver import solve_transient

config = {
    "fluid": "Water",
    "t_span": [0, 60],
    "t_eval_steps": 30,
    "T0": 298.15,
    "P0": 101325,
    "rtol": 1e-3,
    "atol": 1e-5,
    "solver_method": "Radau",
    "stiffness_detection": True,
    "components": [
        {
            "type": "boiler",
            "params": {
                "Q_dot_kW": 5000,
                "UA_kW_K": 50,
                "T_source_K": 900,
                "mass_fluid": 500,
                "mass_wall": 2000,
                "P_Pa": 3_000_000,
                "mass_flow": 2.5,
                "cp_wall": 500,
            },
            "initial_conditions": {
                "T_fluid_boiler": 320,
                "T_wall_boiler": 330,
            },
        },
        {
            "type": "turbine",
            "params": {
                "eta_isentropic": 0.85,
                "P_in_Pa": 3_000_000,
                "P_out_Pa": 10_000,
                "mass_flow": 2.5,
            },
            "initial_conditions": {"omega_turbine": 314.16},
        },
        {
            "type": "condenser",
            "params": {
                "UA_kW_K": 30,
                "T_sink_K": 298.15,
                "mass_fluid": 200,
                "P_Pa": 10_000,
                "mass_flow": 2.5,
            },
            "initial_conditions": {"T_fluid_condenser": 310},
        },
        {
            "type": "pump",
            "params": {
                "eta_isentropic": 0.80,
                "P_in_Pa": 10_000,
                "P_out_Pa": 3_000_000,
                "mass_flow": 2.5,
            },
            "initial_conditions": {"T_pump_out": 320},
        },
    ],
}

try:
    result = solve_transient(config)
    print("success:", result["success"])
    print("errors:", result.get("errors", []))
    print("vars:", list(result.get("variables", {}).keys()))
    print("t points:", len(result.get("t", [])))
    if result.get("variables"):
        for k, v in result["variables"].items():
            print(f"  {k}[0]={v[0]:.2f}  [{-1}]={v[-1]:.2f}")
except Exception as e:
    import traceback
    traceback.print_exc()
    print("EXCEPTION:", e)
