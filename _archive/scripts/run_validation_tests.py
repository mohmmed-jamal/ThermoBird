"""
ThermoBird v2 — Validation Test Runner

Run this script to execute all textbook validation tests:
    python run_validation_tests.py

Or run specific tests:
    python run_validation_tests.py test_carnot_cycle_efficiency
    python run_validation_tests.py test_moran_rankine_example_8_1
"""
import sys
import subprocess


def run_all_tests():
    """Run all validation tests with verbose output."""
    print("=" * 70)
    print("ThermoBird v2 — Textbook Validation Tests")
    print("=" * 70)
    print()
    
    result = subprocess.run(
        ["python", "-m", "pytest", "tests/test_textbook_validation.py", "-v", "--tb=short"],
        cwd=".",
        capture_output=False,
    )
    
    return result.returncode


def run_specific_test(test_name: str):
    """Run a specific test by name."""
    print(f"Running test: {test_name}")
    print("=" * 70)
    
    result = subprocess.run(
        ["python", "-m", "pytest", f"tests/test_textbook_validation.py::{test_name}", "-v", "--tb=short"],
        cwd=".",
        capture_output=False,
    )
    
    return result.returncode


if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Run specific test
        test_name = sys.argv[1]
        exit_code = run_specific_test(test_name)
    else:
        # Run all tests
        exit_code = run_all_tests()
    
    sys.exit(exit_code)
