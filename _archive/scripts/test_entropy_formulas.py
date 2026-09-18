"""
Quick test to verify entropy formulas are correct after fixes.
Run this to validate Second Law compliance.
"""
import sys
sys.path.insert(0, 'C:\\ThermoBird\\backend')

from app.core.cycle_engine import run_full_analysis

def test_rankine_entropy():
    """Test Rankine cycle entropy generation - all components should have Ṡ_gen ≥ 0"""
    print("\n" + "="*70)
    print("TEST 1: RANKINE CYCLE ENTROPY VALIDATION")
    print("="*70)
    
    inputs = {
        "cycle_type": "rankine",
        "fluid": "Water",
        "mass_flow": 1.0,
        "P_boiler": 3_000_000,
        "T_superheat": 500,
        "P_condenser": 10_000,
        "eta_pump": 0.80,
        "eta_turbine": 0.85,
        "T0": 298.15,
        "P0": 101_325,
    }
    
    result, duration_ms = run_full_analysis(inputs)
    
    if not result["success"]:
        print(f"❌ FAILED: {result.get('error_message')}")
        return False
    
    print(f"✓ Cycle solved in {duration_ms} ms")
    print("\nEntropy Generation Breakdown:")
    print("-" * 70)
    
    all_valid = True
    for comp in result["entropy"]["component_breakdown"]:
        sgen = comp["Sgen_W_per_K"]
        share = comp["share_pct"]
        status = "✓" if sgen >= -1e-6 else "❌"  # Allow small numerical tolerance
        
        if sgen < -1e-6:
            all_valid = False
            
        print(f"{status} {comp['name']:15s}  Ṡ_gen = {sgen:10.6f} W/K  ({share:5.2f}%)")
    
    total_sgen = result["entropy"]["total_Sgen_W_per_K"]
    print("-" * 70)
    print(f"{'Total':17s}  Ṡ_gen = {total_sgen:10.6f} W/K  (100.00%)")
    
    if all_valid and total_sgen >= -1e-6:
        print("\n✅ PASS: All entropy generation values are non-negative")
        return True
    else:
        print("\n❌ FAIL: Second Law violation detected!")
        return False


def test_brayton_entropy():
    """Test Brayton cycle entropy generation"""
    print("\n" + "="*70)
    print("TEST 2: BRAYTON CYCLE ENTROPY VALIDATION")
    print("="*70)
    
    inputs = {
        "cycle_type": "brayton",
        "fluid": "Air",
        "mass_flow": 1.0,
        "T_inlet": 298.15,
        "P_inlet": 101_325,
        "pressure_ratio": 8.0,
        "T_turbine_inlet": 1400,
        "eta_compressor": 0.85,
        "eta_turbine": 0.88,
        "T0": 298.15,
        "P0": 101_325,
    }
    
    result, duration_ms = run_full_analysis(inputs)
    
    if not result["success"]:
        print(f"❌ FAILED: {result.get('error_message')}")
        return False
    
    print(f"✓ Cycle solved in {duration_ms} ms")
    print("\nEntropy Generation Breakdown:")
    print("-" * 70)
    
    all_valid = True
    for comp in result["entropy"]["component_breakdown"]:
        sgen = comp["Sgen_W_per_K"]
        share = comp["share_pct"]
        status = "✓" if sgen >= -1e-6 else "❌"
        
        if sgen < -1e-6:
            all_valid = False
            
        print(f"{status} {comp['name']:15s}  Ṡ_gen = {sgen:10.6f} W/K  ({share:5.2f}%)")
    
    total_sgen = result["entropy"]["total_Sgen_W_per_K"]
    print("-" * 70)
    print(f"{'Total':17s}  Ṡ_gen = {total_sgen:10.6f} W/K  (100.00%)")
    
    if all_valid and total_sgen >= -1e-6:
        print("\n✅ PASS: All entropy generation values are non-negative")
        return True
    else:
        print("\n❌ FAIL: Second Law violation detected!")
        return False


def test_vcr_entropy():
    """Test VCR cycle entropy generation"""
    print("\n" + "="*70)
    print("TEST 3: VCR CYCLE ENTROPY VALIDATION")
    print("="*70)
    
    inputs = {
        "cycle_type": "vapor_compression",
        "fluid": "R134a",
        "mass_flow": 1.0,
        "T_evaporator": 258.15,
        "T_condenser": 313.15,
        "superheat": 5.0,
        "subcooling": 3.0,
        "eta_compressor": 0.80,
        "T0": 298.15,
        "P0": 101_325,
    }
    
    result, duration_ms = run_full_analysis(inputs)
    
    if not result["success"]:
        print(f"❌ FAILED: {result.get('error_message')}")
        return False
    
    print(f"✓ Cycle solved in {duration_ms} ms")
    print("\nEntropy Generation Breakdown:")
    print("-" * 70)
    
    all_valid = True
    for comp in result["entropy"]["component_breakdown"]:
        sgen = comp["Sgen_W_per_K"]
        share = comp["share_pct"]
        status = "✓" if sgen >= -1e-6 else "❌"
        
        if sgen < -1e-6:
            all_valid = False
            
        print(f"{status} {comp['name']:15s}  Ṡ_gen = {sgen:10.6f} W/K  ({share:5.2f}%)")
    
    total_sgen = result["entropy"]["total_Sgen_W_per_K"]
    print("-" * 70)
    print(f"{'Total':17s}  Ṡ_gen = {total_sgen:10.6f} W/K  (100.00%)")
    
    if all_valid and total_sgen >= -1e-6:
        print("\n✅ PASS: All entropy generation values are non-negative")
        return True
    else:
        print("\n❌ FAIL: Second Law violation detected!")
        return False


if __name__ == "__main__":
    print("\n🔬 ThermoBird Entropy Formula Validation Suite")
    print("Testing Second Law compliance after entropy formula corrections\n")
    
    results = []
    results.append(("Rankine", test_rankine_entropy()))
    results.append(("Brayton", test_brayton_entropy()))
    results.append(("VCR", test_vcr_entropy()))
    
    print("\n" + "="*70)
    print("FINAL RESULTS")
    print("="*70)
    
    for cycle, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}  {cycle} Cycle")
    
    all_passed = all(passed for _, passed in results)
    
    if all_passed:
        print("\n🎉 ALL TESTS PASSED! Entropy formulas are correct!")
        print("✅ Ready for production deployment")
        sys.exit(0)
    else:
        print("\n⚠️  SOME TESTS FAILED! Review entropy calculations!")
        sys.exit(1)
