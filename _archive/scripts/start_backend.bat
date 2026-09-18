@echo off
cd /d C:\ThermoBird
call .venv\Scripts\activate.bat
cd backend
python -m uvicorn app.main:app --reload
pause
