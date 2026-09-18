@echo off
echo ============================================
echo  ThermoBird Backend with Error Logging
echo ============================================
echo.
cd /d C:\ThermoBird
call .venv\Scripts\activate.bat

echo [1/2] Python environment activated
echo     Python: %VIRTUAL_ENV%
echo.

cd backend
echo [2/2] Starting FastAPI server...
echo.
echo 🌐 URLs:
echo     Main App: http://localhost:8000
echo     Errors:   http://localhost:8000/debug/errors
echo     Health:   http://localhost:8000/health
echo     API Docs: http://localhost:8000/docs
echo.
echo 📋 To see errors in browser:
echo     1. Open http://localhost:8000/debug/errors
echo     2. Errors will appear here automatically
echo.
echo ============================================
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pause
