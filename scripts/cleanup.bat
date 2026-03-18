@echo off
REM Script de limpieza para preparar el repositorio para deployment
REM TrackVis - Eye Tracking Visualization System

echo.
echo ============================================
echo    Limpiando repositorio para deployment
echo ============================================
echo.

REM Eliminar documentación de análisis
echo [INFO] Eliminando documentacion de analisis...
if exist "ARCHIVOS_NO_USADOS.md" del /q "ARCHIVOS_NO_USADOS.md"
if exist "CSV_NO_USADOS.md" del /q "CSV_NO_USADOS.md"
if exist "JSON_NO_USADOS.md" del /q "JSON_NO_USADOS.md"
if exist "CONTROLLERS_NO_USADOS.md" del /q "CONTROLLERS_NO_USADOS.md"
if exist "BRUSH_IMPLEMENTACION.md" del /q "BRUSH_IMPLEMENTACION.md"

REM Eliminar controllers renombrados
echo [INFO] Eliminando controllers renombrados...
del /q /s "app\controllers\*__.py" 2>nul
del /q /s "app\controllers\*_old.py" 2>nul

REM Eliminar templates renombrados
echo [INFO] Eliminando templates renombrados...
del /q /s "templates\*__.html" 2>nul
del /q /s "templates\*_old.html" 2>nul

REM Eliminar logs
echo [INFO] Eliminando logs...
del /q *.log 2>nul
del /q flask.log flask_new.log server.log 2>nul

REM Eliminar resultados CSV generados
echo [INFO] Eliminando resultados CSV generados...
del /q RESULTADO_*.csv 2>nul

REM Eliminar glyph data generado
echo [INFO] Eliminando glyph data generado...
del /q glyph_data.json 2>nul

REM Limpiar cache de Python
echo [INFO] Limpiando cache de Python...
for /d /r . %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d" 2>nul
del /s /q *.pyc 2>nul
del /s /q *.pyo 2>nul

REM Limpiar cache de notebooks
echo [INFO] Limpiando cache de notebooks...
for /d /r . %%d in (.ipynb_checkpoints) do @if exist "%%d" rd /s /q "%%d" 2>nul

REM Limpiar archivos temporales
echo [INFO] Limpiando archivos temporales...
del /s /q *.tmp 2>nul
del /s /q *.bak 2>nul

echo.
echo [OK] Limpieza completada
echo.
echo [IMPORTANTE] Los archivos de datos (static\data\) no se eliminaron
echo              Para deployment en GitHub, considera:
echo              1. Usar Git LFS para archivos grandes
echo              2. Subir datos a Google Drive/Dropbox
echo              3. Ver DEPLOYMENT_GUIDE.md para mas informacion
echo.

pause
