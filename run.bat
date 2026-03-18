@echo off
REM Script de inicio para Windows
REM TrackVis - Eye Tracking Visualization System

echo.
echo ============================================
echo    TrackVis - Eye Tracking Visualization
echo ============================================
echo.

REM Verificar si Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no esta instalado
    echo Por favor instala Python 3.8 o superior desde https://www.python.org/
    pause
    exit /b 1
)

echo [OK] Python encontrado
python --version

REM Verificar si el entorno virtual existe
if not exist "venv" (
    echo.
    echo [INFO] Creando entorno virtual...
    python -m venv venv
    echo [OK] Entorno virtual creado
)

REM Activar entorno virtual
echo.
echo [INFO] Activando entorno virtual...
call venv\Scripts\activate.bat

REM Verificar si las dependencias están instaladas
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [INFO] Instalando dependencias...
    pip install -r requirements.txt
    echo [OK] Dependencias instaladas
)

REM Verificar que existan los archivos de datos
if not exist "static\data\df_final1.csv" (
    echo.
    echo [ERROR] Archivo df_final1.csv no encontrado
    echo Por favor descarga los datos necesarios en static\data\
    echo Ver README.md para mas informacion
    pause
    exit /b 1
)

if not exist "static\data\ivt_precalculated.csv" (
    echo.
    echo [ERROR] Archivo ivt_precalculated.csv no encontrado
    echo Por favor descarga los datos necesarios en static\data\
    echo Ver README.md para mas informacion
    pause
    exit /b 1
)

echo [OK] Archivos de datos encontrados
echo.
echo ============================================
echo    Iniciando servidor Flask...
echo    URL: http://localhost:8081
echo ============================================
echo.
echo Presiona Ctrl+C para detener el servidor
echo.

REM Iniciar la aplicación
python main2.py

pause
