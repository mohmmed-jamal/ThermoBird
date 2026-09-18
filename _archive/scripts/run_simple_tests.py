"""
Simple test runner - no pytest required
Run: python run_simple_tests.py
"""
import sys
import traceback

# Add app to path
sys.path.insert(0, '.')

def test_basic_solver():
    """Test that solver runs without crashing."""
    from app.core.transient.ode_solver import solve_transient
    
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
    
    print(f"  Success: {result['success']}")
    print(f"  Time points: {len(result['t'])}")
    print(f"  Variables: {list(result['variables'].keys())}")
    print(f"  Derived: {list(result['derived'].keys())}")
    print(f"  Errors: {result.get('errors', [])}")
    
    assert result['success'], f"Solver failed: {result.get('errors', [])}"
    assert len(result['derived']) > 0, "No derived quantities"
    
    # Check for NaN (should not be all NaN)
    eta = result['derived'].get('eta_thermal', [])
    valid_eta = [x for x in eta if not (x != x)]  # NaN check
    print(f"  Valid efficiency points: {len(valid_eta)}/{len(eta)}")
    
    return True


def test_error_handling():
    """Test that missing components produce errors (not silent zeros)."""
    from app.core.transient.ode_solver import solve_transient
    
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
    
    print(f"  Success: {result['success']}")
    print(f"  Errors: {result.get('errors', [])}")
    
    # Should have errors about missing components
    assert len(result.get('errors', [])) > 0, "Should report missing components"
    
    return True


def test_component_registry():
    """Test that all component types are registered."""
    from app.core.transient.component_models import COMPONENT_REGISTRY
    
    expected = ['boiler', 'turbine', 'condenser', 'pump', 
                'compressor', 'heat_exchanger', 'evaporator', 'expansion_valve']
    
    print(f"  Registered: {list(COMPONENT_REGISTRY.keys())}")
    
    for comp in expected:
        assert comp in COMPONENT_REGISTRY, f"Missing {comp}"
    
    return True


def run_all_tests():
    """Run all tests."""
    tests = [
        ("Component Registry", test_component_registry),
        ("Basic Solver", test_basic_solver),
        ("Error Handling", test_error_handling),
    ]
    
    print("=" * 60)
    print("ThermoBird Transient Validation Tests")
    print("=" * 60)
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        print(f"\n▶ {name}...")
        try:
            test_func()
            print(f"  ✓ PASSED")
            passed += 1
        except Exception as e:
            print(f"  ✗ FAILED: {e}")
            traceback.print_exc()
            failed += 1
    
    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
