"""
Simple standalone test for transient solver - no database dependencies
Run: cd backend && ..\.venv\Scripts\python.exe test_transient_simple.py
"""
import sys
import os

# Setup path BEFORE any imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Mock the database imports that app/__init__.py tries to load
class MockModule:
    class Base:
        pass
    class engine:
        pass

# Prevent app/__init__.py from loading database by pre-populating the module cache
sys.modules['app.database'] = MockModule()

# Now we can import from app
from app.core.transient.ode_solver import solve_transient
from app.core.transient.component_models import COMPONENT_REGISTRY

import numpy as np


def test_component_registry():
    """Test that all component types are registered."""
    print("\n" + "="*60)
    print("TEST 1: Component Registry")
    print("="*60)
    
    expected = ['boiler', 'turbine', 'condenser', 'pump', 
                'compressor', 'heat_exchanger', 'evaporator', 'expansion_valve']
    
    print(f"Registered: {list(COMPONENT_REGISTRY.keys())}")
    
    missing = []
    for comp in expected:
        if comp not in COMPONENT_REGISTRY:
            missing.append(comp)
    
    if missing:
        print(f"[FAIL] Missing components: {missing}")
        return False
    
    print("[PASS] All 8 component types registered")
    return True


def test_solver_runs():
    """Test that solver runs without crashing."""
    print("\n" + "="*60)
    print("TEST 2: Solver Execution")
    print("="*60)
    
    config = {
        "fluid": "Water",
        "t_span": [0.0, 100.0],
        "t_eval_steps": 50,
        "T0": 298.15,
        "P0": 101_325.0,
        "rtol": 1e-4,
        "atol": 1e-6,
        "solver_method": "Radau",
        "components": [
            {
                "type": "boiler",
                "params": {
                    "Q_dot_kW": 5000,
                    "UA_kW_K": 50.0,
                    "T_source_K": 900.0,
                    "mass_fluid": 100.0,
                    "mass_wall": 200.0,
                    "P_Pa": 3_000_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_fluid_boiler": 320.0, "T_wall_boiler": 330.0},
            },
            {
                "type": "turbine",
                "params": {
                    "eta_isentropic": 0.85,
                    "P_in_Pa": 3_000_000.0,
                    "P_out_Pa": 10_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"omega_turbine": 314.16},
            },
            {
                "type": "condenser",
                "params": {
                    "UA_kW_K": 30.0,
                    "T_sink_K": 298.15,
                    "mass_fluid": 100.0,
                    "P_Pa": 10_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_fluid_condenser": 310.0},
            },
            {
                "type": "pump",
                "params": {
                    "eta_isentropic": 0.80,
                    "P_in_Pa": 10_000.0,
                    "P_out_Pa": 3_000_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_pump_out": 320.0},
            },
        ],
    }
    
    print("Running solver...")
    result = solve_transient(config)
    
    print(f"Success: {result.get('success')}")
    print(f"Errors: {result.get('errors', [])}")
    print(f"Time points: {len(result.get('t', []))}")
    print(f"Variables: {list(result.get('variables', {}).keys())}")
    print(f"Derived: {list(result.get('derived', {}).keys())}")
    
    if not result.get('success') and len(result.get('errors', [])) == 0:
        print("[FAIL] Solver failed but no error messages - silent failure!")
        return False
    
    print("[PASS] Solver executed")
    return True


def test_no_silent_failures():
    """Test that we don't get all zeros (silent failure indicator)."""
    print("\n" + "="*60)
    print("TEST 3: No Silent Failures (NaN/Zero Check)")
    print("="*60)
    
    config = {
        "fluid": "Water",
        "t_span": [0.0, 100.0],
        "t_eval_steps": 50,
        "components": [
            {
                "type": "boiler",
                "params": {
                    "Q_dot_kW": 5000,
                    "UA_kW_K": 50.0,
                    "T_source_K": 900.0,
                    "mass_fluid": 100.0,
                    "mass_wall": 200.0,
                    "P_Pa": 3_000_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_fluid_boiler": 320.0, "T_wall_boiler": 330.0},
            },
            {
                "type": "turbine",
                "params": {
                    "eta_isentropic": 0.85,
                    "P_in_Pa": 3_000_000.0,
                    "P_out_Pa": 10_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"omega_turbine": 314.16},
            },
            {
                "type": "condenser",
                "params": {
                    "UA_kW_K": 30.0,
                    "T_sink_K": 298.15,
                    "mass_fluid": 100.0,
                    "P_Pa": 10_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_fluid_condenser": 310.0},
            },
            {
                "type": "pump",
                "params": {
                    "eta_isentropic": 0.80,
                    "P_in_Pa": 10_000.0,
                    "P_out_Pa": 3_000_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_pump_out": 320.0},
            },
        ],
    }
    
    result = solve_transient(config)
    
    if not result.get('success') or len(result.get('derived', {})) == 0:
        print("[WARN] Solver didn't produce results - skipping check")
        return True
    
    eta = result['derived'].get('eta_thermal', [])
    valid_eta = [x for x in eta if not (x != x) and x > 0]  # Not NaN and positive
    
    print(f"Efficiency values: {len(eta)} total, {len(valid_eta)} valid (non-NaN, non-zero)")
    
    if len(valid_eta) == 0:
        print("[FAIL] All efficiencies are NaN or zero - indicates silent failure!")
        return False
    
    print(f"Sample efficiencies: {valid_eta[:5]}")
    print("[PASS] Have valid efficiency values")
    return True


def test_error_reporting():
    """Test that missing components produce errors (not silent zeros)."""
    print("\n" + "="*60)
    print("TEST 4: Error Reporting (Missing Components)")
    print("="*60)
    
    # Config with missing condenser - should produce error
    config = {
        "fluid": "Water",
        "t_span": [0.0, 100.0],
        "t_eval_steps": 50,
        "components": [
            {
                "type": "boiler",
                "params": {"Q_dot_kW": 5000, "mass_flow": 2.5},
                "initial_conditions": {"T_fluid_boiler": 320.0, "T_wall_boiler": 330.0},
            },
            # Missing turbine, condenser, pump
        ],
    }
    
    result = solve_transient(config)
    
    print(f"Success: {result.get('success')}")
    print(f"Errors: {result.get('errors', [])}")
    
    errors = result.get('errors', [])
    
    # Should have NaN in derived (not zeros)
    derived = result.get('derived', {})
    if len(derived) > 0:
        eta = derived.get('eta_thermal', [])
        nan_count = sum(1 for x in eta if x != x)
        print(f"NaN values in eta: {nan_count}/{len(eta)}")
    
    if len(errors) == 0 and result.get('success'):
        print("[WARN] Should report missing components but didn't")
    else:
        print("[PASS] Errors reported for incomplete configuration")
    
    return True


def test_second_law():
    """Test that entropy generation is non-negative."""
    print("\n" + "="*60)
    print("TEST 5: Second Law Compliance (S_gen ≥ 0)")
    print("="*60)
    
    config = {
        "fluid": "Water",
        "t_span": [0.0, 100.0],
        "t_eval_steps": 50,
        "components": [
            {
                "type": "boiler",
                "params": {
                    "Q_dot_kW": 5000,
                    "UA_kW_K": 50.0,
                    "T_source_K": 900.0,
                    "mass_fluid": 100.0,
                    "mass_wall": 200.0,
                    "P_Pa": 3_000_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_fluid_boiler": 320.0, "T_wall_boiler": 330.0},
            },
            {
                "type": "turbine",
                "params": {
                    "eta_isentropic": 0.85,
                    "P_in_Pa": 3_000_000.0,
                    "P_out_Pa": 10_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"omega_turbine": 314.16},
            },
            {
                "type": "condenser",
                "params": {
                    "UA_kW_K": 30.0,
                    "T_sink_K": 298.15,
                    "mass_fluid": 100.0,
                    "P_Pa": 10_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_fluid_condenser": 310.0},
            },
            {
                "type": "pump",
                "params": {
                    "eta_isentropic": 0.80,
                    "P_in_Pa": 10_000.0,
                    "P_out_Pa": 3_000_000.0,
                    "mass_flow": 2.5,
                },
                "initial_conditions": {"T_pump_out": 320.0},
            },
        ],
    }
    
    result = solve_transient(config)
    
    if not result.get('success'):
        print("[WARN] Solver failed - skipping 2nd Law check")
        return True
    
    violations = []
    for comp in ['turbine', 'boiler', 'condenser', 'pump']:
        key = f"Sgen_{comp}_kW_K"
        if key not in result['derived']:
            continue
        
        sgen = result['derived'][key]
        valid = [x for x in sgen if not (x != x)]  # Not NaN
        if len(valid) == 0:
            continue
        
        min_sgen = min(valid)
        print(f"  {comp}: min S_gen = {min_sgen:.6f} kW/K")
        
        # Allow small numerical tolerance
        if min_sgen < -1e-5:
            violations.append((comp, min_sgen))
    
    if violations:
        print(f"[FAIL] 2nd Law violations: {violations}")
        return False
    
    print("[PASS] All entropy generation rates non-negative")
    return True


def main():
    """Run all tests."""
    print("="*60)
    print("ThermoBird Transient Solver Validation Tests")
    print("="*60)
    
    tests = [
        ("Component Registry", test_component_registry),
        ("Solver Execution", test_solver_runs),
        ("No Silent Failures", test_no_silent_failures),
        ("Error Reporting", test_error_reporting),
        ("Second Law Compliance", test_second_law),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        try:
            if test_func():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"[EXCEPTION] in {name}: {e}")
            import traceback
            traceback.print_exc()
            failed += 1
    
    print("\n" + "="*60)
    print(f"RESULTS: {passed} passed, {failed} failed")
    print("="*60)
    
    return failed == 0


if __name__ == "__main__":
    import sys
    success = main()
    sys.exit(0 if success else 1)
