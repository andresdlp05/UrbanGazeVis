@echo off
REM Script para descargar imágenes desde Google Drive (Windows)
REM TrackVis - Eye Tracking Visualization System

echo ==========================================
echo   TrackVis - Image Downloader (Windows)
echo ==========================================
echo.

REM ============================================
REM IMPORTANTE: Reemplaza estos FILE_IDs con los IDs de tus archivos en Google Drive
REM ============================================

REM Para obtener el FILE_ID de Google Drive:
REM 1. Sube tu carpeta/archivo a Google Drive
REM 2. Haz clic derecho - Compartir - Obtener enlace
REM 3. El enlace será: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
REM 4. Copia solo el FILE_ID

echo.
echo [CONFIGURACION] Por favor, configura los FILE_IDs en este script
echo Edita: scripts\download_images.bat
echo.

REM ============================================
REM Configuración de FILE_IDs (EDITAR AQUÍ)
REM ============================================

SET IMAGES_ORIGINAL_ID=YOUR_FILE_ID_HERE
SET IMAGES_SEG_ID=YOUR_FILE_ID_HERE
SET IMAGES_GROUP_ID=YOUR_FILE_ID_HERE
SET IMAGES_DISORDER_ID=YOUR_FILE_ID_HERE
SET IMAGES_GROUP_DISORDER_ID=YOUR_FILE_ID_HERE
SET DATA_CSV_ID=YOUR_FILE_ID_HERE

REM ============================================
REM Crear directorios necesarios
REM ============================================

echo [INFO] Creando directorios...
mkdir static\images\images\images 2>nul
mkdir static\images\images\images_seg 2>nul
mkdir static\images\images\ADE20K-Group\images 2>nul
mkdir static\images\images\ADE20K-Disorder\images 2>nul
mkdir static\images\images\ADE20K-GroupDisorder\images 2>nul
mkdir static\data 2>nul
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

REM Imágenes originales
if NOT "%IMAGES_ORIGINAL_ID%"=="YOUR_FILE_ID_HERE" (
    echo [INFO] Descargando imagenes originales...
    if not exist "static\images\images\images\0.jpg" (
        gdown "https://drive.google.com/uc?id=%IMAGES_ORIGINAL_ID%" -O tmp\images_original.zip
        tar -xf tmp\images_original.zip -C static\images\images\images
        del tmp\images_original.zip
        echo [OK] Imagenes originales descargadas
    ) else (
        echo [OK] Imagenes originales ya existen
    )
) else (
    echo [SKIP] FILE_ID no configurado para: Imagenes originales
)

REM Imágenes de segmentación - ADE20K Classes
if NOT "%IMAGES_SEG_ID%"=="YOUR_FILE_ID_HERE" (
    echo [INFO] Descargando segmentacion ADE20K Classes...
    if not exist "static\images\images\images_seg\0.JPEG" (
        gdown "https://drive.google.com/uc?id=%IMAGES_SEG_ID%" -O tmp\images_seg.zip
        tar -xf tmp\images_seg.zip -C static\images\images\images_seg
        del tmp\images_seg.zip
        echo [OK] Segmentacion ADE20K Classes descargada
    ) else (
        echo [OK] Segmentacion ADE20K Classes ya existe
    )
) else (
    echo [SKIP] FILE_ID no configurado para: Segmentacion ADE20K Classes
)

REM Imágenes de segmentación - ADE20K Groups
if NOT "%IMAGES_GROUP_ID%"=="YOUR_FILE_ID_HERE" (
    echo [INFO] Descargando segmentacion ADE20K Groups...
    if not exist "static\images\images\ADE20K-Group\images\0.png" (
        gdown "https://drive.google.com/uc?id=%IMAGES_GROUP_ID%" -O tmp\images_group.zip
        tar -xf tmp\images_group.zip -C static\images\images\ADE20K-Group\images
        del tmp\images_group.zip
        echo [OK] Segmentacion ADE20K Groups descargada
    ) else (
        echo [OK] Segmentacion ADE20K Groups ya existe
    )
) else (
    echo [SKIP] FILE_ID no configurado para: Segmentacion ADE20K Groups
)

REM Imágenes de segmentación - ADE20K Disorder
if NOT "%IMAGES_DISORDER_ID%"=="YOUR_FILE_ID_HERE" (
    echo [INFO] Descargando segmentacion ADE20K Disorder...
    if not exist "static\images\images\ADE20K-Disorder\images\0.png" (
        gdown "https://drive.google.com/uc?id=%IMAGES_DISORDER_ID%" -O tmp\images_disorder.zip
        tar -xf tmp\images_disorder.zip -C static\images\images\ADE20K-Disorder\images
        del tmp\images_disorder.zip
        echo [OK] Segmentacion ADE20K Disorder descargada
    ) else (
        echo [OK] Segmentacion ADE20K Disorder ya existe
    )
) else (
    echo [SKIP] FILE_ID no configurado para: Segmentacion ADE20K Disorder
)

REM Imágenes de segmentación - ADE20K GroupDisorder
if NOT "%IMAGES_GROUP_DISORDER_ID%"=="YOUR_FILE_ID_HERE" (
    echo [INFO] Descargando segmentacion ADE20K GroupDisorder...
    if not exist "static\images\images\ADE20K-GroupDisorder\images\0.png" (
        gdown "https://drive.google.com/uc?id=%IMAGES_GROUP_DISORDER_ID%" -O tmp\images_group_disorder.zip
        tar -xf tmp\images_group_disorder.zip -C static\images\images\ADE20K-GroupDisorder\images
        del tmp\images_group_disorder.zip
        echo [OK] Segmentacion ADE20K GroupDisorder descargada
    ) else (
        echo [OK] Segmentacion ADE20K GroupDisorder ya existe
    )
) else (
    echo [SKIP] FILE_ID no configurado para: Segmentacion ADE20K GroupDisorder
)

REM Limpiar
rmdir /s /q tmp 2>nul

echo.
echo ==========================================
echo   Descarga completada
echo ==========================================
echo.
echo [INFO] Si saltaste descargas, edita este script y configura los FILE_IDs
echo.

pause
