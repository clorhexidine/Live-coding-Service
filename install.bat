@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ============================================
echo   Live Coding Service — установка
echo ============================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Python не найден.
    echo.
    echo Скачайте и установите Python 3.11+ с сайта:
    echo https://www.python.org/downloads/
    echo.
    echo ВАЖНО: при установке поставьте галочку
    echo        "Add Python to PATH"
    echo.
    pause
    exit /b 1
)

echo [OK] Python:
python --version
echo.

echo Устанавливаю зависимости...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if errorlevel 1 (
    echo.
    echo [ОШИБКА] Установка не удалась.
    echo Убедитесь что есть интернет и повторите.
    pause
    exit /b 1
)

echo.
echo [OK] Все зависимости установлены.
echo.
echo Теперь запустите run_server.bat
echo.
pause
