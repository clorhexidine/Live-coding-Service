@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ============================================
echo   Live Coding Service — запуск сервера
echo ============================================
echo.

:: Проверяем наличие Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Python не найден.
    echo.
    echo Установите Python 3.11+ с https://www.python.org/downloads/
    echo При установке обязательно поставьте галочку "Add Python to PATH"
    echo.
    pause
    exit /b 1
)

echo [OK] Python найден:
python --version
echo.

:: Проверяем наличие pip
python -m pip --version >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] pip не найден. Переустановите Python.
    pause
    exit /b 1
)

:: Проверяем установлен ли uvicorn
python -m uvicorn --version >nul 2>&1
if errorlevel 1 (
    echo [!] Зависимости не установлены. Устанавливаю...
    echo.
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [ОШИБКА] Не удалось установить зависимости.
        echo Попробуйте вручную: python -m pip install -r requirements.txt
        pause
        exit /b 1
    )
    echo.
    echo [OK] Зависимости установлены.
    echo.
)

echo [OK] Зависимости в порядке.
echo.
echo Сервер запускается на http://127.0.0.1:8000/
echo Для остановки нажмите Ctrl+C
echo.

python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

if errorlevel 1 (
    echo.
    echo [ОШИБКА] Сервер завершился с ошибкой.
    echo Прочитайте сообщение выше.
    pause
)
