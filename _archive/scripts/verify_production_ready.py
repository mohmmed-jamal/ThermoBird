#!/usr/bin/env python3
"""
🚀 ThermoBird Final Pre-Commit Verification
Run this script to ensure everything is ready for production deployment.
"""
import sys
import subprocess
from pathlib import Path

# ANSI colors
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
BOLD = '\033[1m'
RESET = '\033[0m'

def print_header(text):
    print(f"\n{BOLD}{BLUE}{'='*70}{RESET}")
    print(f"{BOLD}{BLUE}{text.center(70)}{RESET}")
    print(f"{BOLD}{BLUE}{'='*70}{RESET}\n")

def print_success(text):
    print(f"{GREEN}✓{RESET} {text}")

def print_error(text):
    print(f"{RED}✗{RESET} {text}")

def print_warning(text):
    print(f"{YELLOW}⚠{RESET} {text}")

def run_entropy_tests():
    """Run entropy formula validation tests"""
    print_header("PHASE 1: Entropy Formula Validation")
    
    try:
        result = subprocess.run(
            [sys.executable, "C:\\ThermoBird\\backend\\test_entropy_formulas.py"],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        print(result.stdout)
        
        if result.returncode == 0:
            print_success("All entropy formulas validated!")
            return True
        else:
            print_error("Entropy validation FAILED!")
            print(result.stderr)
            return False
            
    except subprocess.TimeoutExpired:
        print_error("Entropy tests timed out (>60s)")
        return False
    except Exception as e:
        print_error(f"Could not run entropy tests: {e}")
        return False

def check_backend_running():
    """Check if backend is running"""
    print_header("PHASE 2: Backend Health Check")
    
    try:
        import requests
        response = requests.get("http://localhost:8000/health", timeout=5)
        
        if response.status_code == 200:
            print_success("Backend is running and healthy")
            return True
        else:
            print_error(f"Backend returned status {response.status_code}")
            return False
            
    except requests.exceptions.ConnectionError:
        print_error("Backend is NOT running on localhost:8000")
        print(f"{YELLOW}→ Please start backend: cd C:\\ThermoBird\\backend && uvicorn app.main:app{RESET}")
        return False
    except Exception as e:
        print_error(f"Could not check backend: {e}")
        return False

def check_frontend_build():
    """Check if frontend builds successfully"""
    print_header("PHASE 3: Frontend Build Check")
    
    try:
        print("Building frontend... (this may take 30-60 seconds)")
        result = subprocess.run(
            ["npm", "run", "build"],
            cwd="C:\\ThermoBird\\frontend",
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode == 0:
            print_success("Frontend builds successfully!")
            return True
        else:
            print_error("Frontend build FAILED!")
            print(result.stderr)
            return False
            
    except subprocess.TimeoutExpired:
        print_error("Frontend build timed out (>120s)")
        return False
    except Exception as e:
        print_error(f"Could not build frontend: {e}")
        return False

def check_console_logs():
    """Search for debug console.log statements"""
    print_header("PHASE 4: Debug Logging Check")
    
    frontend_path = Path("C:\\ThermoBird\\frontend\\src")
    found_logs = []
    
    # Search for console.log in TypeScript files
    for ts_file in frontend_path.rglob("*.ts*"):
        if "node_modules" in str(ts_file):
            continue
            
        content = ts_file.read_text(encoding='utf-8')
        lines = content.split('\n')
        
        for i, line in enumerate(lines, 1):
            if 'console.log' in line and not line.strip().startswith('//'):
                found_logs.append((ts_file, i, line.strip()))
    
    if not found_logs:
        print_success("No debug console.log statements found!")
        return True
    else:
        print_error(f"Found {len(found_logs)} console.log statements:")
        for file, line_no, line in found_logs:
            print(f"  {file}:{line_no} → {line[:80]}")
        return False

def manual_test_reminder():
    """Print manual testing checklist"""
    print_header("PHASE 5: Manual Testing Required")
    
    print(f"{BOLD}You must manually verify these features:{RESET}\n")
    
    tests = [
        ("Transient Analysis", [
            "Navigate to http://localhost:3000",
            "Canvas tab → Build Rankine cycle (4 components)",
            "Toggle 'Steady State → Transient'",
            "Transient tab → Click 'Run Transient Simulation'",
            "Verify: Progress bar → Completes → Results display"
        ]),
        ("Parametric Analysis", [
            "Parametric tab → Select Rankine",
            "Add sweep: P_boiler (1000-5000 kPa, 10 steps)",
            "Click 'Run Parametric Study'",
            "Verify: Results table + charts display"
        ]),
        ("Steady-State Cycles", [
            "Canvas → Build any cycle",
            "Click 'Run Analysis'",
            "Results tab → Verify all data populated",
            "Check entropy values (all Ṡ_gen ≥ 0)"
        ])
    ]
    
    for test_name, steps in tests:
        print(f"{YELLOW}□{RESET} {BOLD}{test_name}:{RESET}")
        for step in steps:
            print(f"  {step}")
        print()
    
    print(f"{BOLD}After testing, if all pass:{RESET}")
    print(f"  {GREEN}→ git add .{RESET}")
    print(f"  {GREEN}→ git commit -m \"fix: correct entropy formulas for adiabatic work devices\"{RESET}")
    print(f"  {GREEN}→ git push origin main{RESET}\n")

def main():
    """Run all pre-commit checks"""
    print(f"\n{BOLD}{BLUE}🔬 ThermoBird Production Readiness Verification{RESET}")
    print(f"{BLUE}Running automated tests before manual verification...{RESET}\n")
    
    results = {
        "Entropy Validation": run_entropy_tests(),
        "Backend Health": check_backend_running(),
        "Frontend Build": check_frontend_build(),
        "Debug Logging": check_console_logs(),
    }
    
    # Print summary
    print_header("AUTOMATED TEST SUMMARY")
    
    all_passed = True
    for test_name, passed in results.items():
        if passed:
            print_success(f"{test_name}: PASS")
        else:
            print_error(f"{test_name}: FAIL")
            all_passed = False
    
    print()
    
    if all_passed:
        print(f"{GREEN}{BOLD}✅ All automated tests PASSED!{RESET}")
        print(f"{YELLOW}→ Now proceed to manual testing (see checklist below){RESET}\n")
        manual_test_reminder()
        return 0
    else:
        print(f"{RED}{BOLD}❌ Some automated tests FAILED!{RESET}")
        print(f"{YELLOW}→ Fix the issues above before proceeding to manual testing{RESET}\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
