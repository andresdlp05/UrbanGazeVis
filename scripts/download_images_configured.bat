@echo off
REM Script configurado con FILE_IDs reales de Google Drive (Windows)
REM TrackVis - Eye Tracking Visualization System

echo ==========================================
echo   TrackVis - Descargando datos desde Google Drive
echo ==========================================
echo.

REM ============================================
REM FILE_IDs configurados
REM ============================================

SET DATA_ZIP_ID=1VKLKNJts-bRPuXT3i34NpPLjF-RksI9G
SET IMAGES_ORIGINAL_ID=14rCekowQUwjdVTEyRvDkbPpYRgRiXYuZ
SET IMAGES_SEG_ID=1uMGA7TJia_VDh5sFz0gGSFU9vNuEAQop
SET DATOS_SEG_ID=1ohj_ZldEcAT4zNW0Nxc-Wb0saYSwoAi3
SET IMAGES_GROUP_ID=1P5axVPdDNwCuaXIlWpTwdQ408RFt_HQm
SET IMAGES_DISORDER_ID=1tbY9eN_WOS3-1RD5lziXB_4RS3TowLzM
SET IMAGES_GROUP_DISORDER_ID=1sjLgAjqbX0by5x-8VkSQWoqWORrC5Uxr

REM ============================================
REM Crear directorios
REM ============================================

echo [INFO] Creando directorios...
mkdir static\data 2>nul
mkdir static\images\images\images 2>nul
mkdir static\images\images\images_seg 2>nul
mkdir static\images\images\ADE20K-Group\images 2>nul
mkdir static\images\images\ADE20K-Disorder\images 2>nul
mkdir static\images\images\ADE20K-GroupDisorder\images 2>nul
mkdir tmp 2>nul

REM ============================================
REM Instalar gdown si no está instalado
REM ============================================

echo [INFO] Verificando gdown...
pip show gdown >nul 2>&1
if errorlevel 1 (
    echo [INFO] Instalando gdown...
    pip install -q gdown
)

REM ============================================
REM Descargar archivos
REM ============================================

echo.
echo [INFO] Iniciando descargas desde Google Drive...
echo.

REM 1. Data (CSV files)
echo [INFO] Descargando datos CSV...
if not exist "static\data\df_final1.csv" (
    echo [INFO] Descargando data.zip...
    gdown "https://drive.google.com/uc?id=%DATA_ZIP_ID%" -O tmp\data.zip
    if errorlevel 0 (
        echo [INFO] Extrayendo data.zip...
        tar -xf tmp\data.zip -C static\data
        del tmp\data.zip
        echo [OK] Datos CSV descargados
    ) else (
        echo [ERROR] Fallo al descargar data.zip
    )
) else (
    echo [OK] Datos CSV ya existen
)

REM 2. Imágenes originales
echo [INFO] Descargando imagenes originales...
if not exist "static\images\images\images\0.jpg" (
    echo [INFO] Descargando images.zip...
    gdown "https://drive.google.com/uc?id=%IMAGES_ORIGINAL_ID%" -O tmp\images.zip
    if errorlevel 0 (
        echo [INFO] Extrayendo images.zip...
        tar -xf tmp\images.zip -C static\images\images\images
        del tmp\images.zip
        echo [OK] Imagenes originales descargadas
    ) else (
        echo [ERROR] Fallo al descargar images.zip
    )
) else (
    echo [OK] Imagenes originales ya existen
)

REM 3. Imágenes de segmentación - ADE20K Classes
echo [INFO] Descargando segmentacion ADE20K Classes...
if not exist "static\images\images\images_seg\0.JPEG" (
    echo [INFO] Descargando images_seg.zip...
    gdown "https://drive.google.com/uc?id=%IMAGES_SEG_ID%" -O tmp\images_seg.zip
    if errorlevel 0 (
        echo [INFO] Extrayendo images_seg.zip...
        tar -xf tmp\images_seg.zip -C static\images\images\images_seg
        del tmp\images_seg.zip
        echo [OK] Segmentacion ADE20K Classes descargada
    ) else (
        echo [ERROR] Fallo al descargar images_seg.zip
    )
) else (
    echo [OK] Segmentacion ADE20K Classes ya existe
)

REM 4. Imágenes de segmentación - ADE20K Groups
echo [INFO] Descargando segmentacion ADE20K Groups...
if not exist "static\images\images\ADE20K-Group\images\0.png" (
    echo [INFO] Descargando ADE20K-Group.zip...
    gdown "https://drive.google.com/uc?id=%IMAGES_GROUP_ID%" -O tmp\ADE20K-Group.zip
    if errorlevel 0 (
        echo [INFO] Extrayendo ADE20K-Group.zip...
        tar -xf tmp\ADE20K-Group.zip -C static\images\images\ADE20K-Group\images
        del tmp\ADE20K-Group.zip
        echo [OK] Segmentacion ADE20K Groups descargada
    ) else (
        echo [ERROR] Fallo al descargar ADE20K-Group.zip
    )
) else (
    echo [OK] Segmentacion ADE20K Groups ya existe
)

REM 5. Imágenes de segmentación - ADE20K Disorder
echo [INFO] Descargando segmentacion ADE20K Disorder...
if not exist "static\images\images\ADE20K-Disorder\images\0.png" (
    echo [INFO] Descargando ADE20K-Disorder.zip...
    gdown "https://drive.google.com/uc?id=%IMAGES_DISORDER_ID%" -O tmp\ADE20K-Disorder.zip
    if errorlevel 0 (
        echo [INFO] Extrayendo ADE20K-Disorder.zip...
        tar -xf tmp\ADE20K-Disorder.zip -C static\images\images\ADE20K-Disorder\images
        del tmp\ADE20K-Disorder.zip
        echo [OK] Segmentacion ADE20K Disorder descargada
    ) else (
        echo [ERROR] Fallo al descargar ADE20K-Disorder.zip
    )
) else (
    echo [OK] Segmentacion ADE20K Disorder ya existe
)

REM 6. Imágenes de segmentación - ADE20K GroupDisorder
echo [INFO] Descargando segmentacion ADE20K GroupDisorder...
if not exist "static\images\images\ADE20K-GroupDisorder\images\0.png" (
    echo [INFO] Descargando ADE20K-GroupDisorder.zip...
    gdown "https://drive.google.com/uc?id=%IMAGES_GROUP_DISORDER_ID%" -O tmp\ADE20K-GroupDisorder.zip
    if errorlevel 0 (
        echo [INFO] Extrayendo ADE20K-GroupDisorder.zip...
        tar -xf tmp\ADE20K-GroupDisorder.zip -C static\images\images\ADE20K-GroupDisorder\images
        del tmp\ADE20K-GroupDisorder.zip
        echo [OK] Segmentacion ADE20K GroupDisorder descargada
    ) else (
        echo [ERROR] Fallo al descargar ADE20K-GroupDisorder.zip
    )
) else (
    echo [OK] Segmentacion ADE20K GroupDisorder ya existe
)

REM ============================================
REM Limpiar
REM ============================================

rmdir /s /q tmp 2>nul

echo.
echo ==========================================
echo   Descarga completada exitosamente
echo ==========================================
echo.
echo [INFO] Verificando archivos descargados...
echo.

if exist "static\data\df_final1.csv" (
    echo [OK] Datos CSV encontrados
) else (
    echo [WARN] Datos CSV no encontrados
)

if exist "static\images\images\images\0.jpg" (
    echo [OK] Imagenes originales encontradas
) else (
    echo [WARN] Imagenes originales no encontradas
)

if exist "static\images\images\images_seg\0.JPEG" (
    echo [OK] Segmentacion ADE20K Classes encontrada
) else (
    echo [WARN] Segmentacion ADE20K Classes no encontrada
)

if exist "static\images\images\ADE20K-Group\images\0.png" (
    echo [OK] Segmentacion ADE20K Groups encontrada
) else (
    echo [WARN] Segmentacion ADE20K Groups no encontrada
)

echo.
echo [INFO] Listo para ejecutar: docker-compose up -d
echo.

pause
