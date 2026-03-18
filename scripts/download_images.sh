#!/bin/bash

# Script para descargar imágenes desde Google Drive
# TrackVis - Eye Tracking Visualization System

set -e  # Salir si hay error

echo "=========================================="
echo "  TrackVis - Image Downloader"
echo "=========================================="
echo ""

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Función para descargar archivo de Google Drive
download_from_gdrive() {
    local FILE_ID=$1
    local OUTPUT_PATH=$2
    local DESCRIPTION=$3

    echo -e "${YELLOW}[INFO]${NC} Descargando: $DESCRIPTION"

    if [ -f "$OUTPUT_PATH" ]; then
        echo -e "${GREEN}[OK]${NC} Archivo ya existe, saltando: $OUTPUT_PATH"
        return 0
    fi

    # Instalar gdown si no está instalado
    if ! command -v gdown &> /dev/null; then
        echo -e "${YELLOW}[INFO]${NC} Instalando gdown..."
        pip install -q gdown
    fi

    # Descargar archivo
    gdown "https://drive.google.com/uc?id=$FILE_ID" -O "$OUTPUT_PATH"

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[OK]${NC} Descarga exitosa: $DESCRIPTION"
    else
        echo -e "${RED}[ERROR]${NC} Fallo al descargar: $DESCRIPTION"
        return 1
    fi
}

# Función para descargar y extraer carpeta comprimida
download_and_extract() {
    local FILE_ID=$1
    local ZIP_NAME=$2
    local EXTRACT_PATH=$3
    local DESCRIPTION=$4

    echo -e "${YELLOW}[INFO]${NC} Descargando: $DESCRIPTION"

    # Verificar si la carpeta ya existe
    if [ -d "$EXTRACT_PATH" ] && [ "$(ls -A $EXTRACT_PATH)" ]; then
        echo -e "${GREEN}[OK]${NC} Carpeta ya existe, saltando: $EXTRACT_PATH"
        return 0
    fi

    # Crear directorio temporal
    mkdir -p tmp

    # Descargar ZIP
    echo -e "${YELLOW}[INFO]${NC} Descargando archivo comprimido..."
    gdown "https://drive.google.com/uc?id=$FILE_ID" -O "tmp/$ZIP_NAME"

    # Extraer
    echo -e "${YELLOW}[INFO]${NC} Extrayendo archivos..."
    unzip -q "tmp/$ZIP_NAME" -d "$EXTRACT_PATH"

    # Limpiar
    rm -f "tmp/$ZIP_NAME"

    echo -e "${GREEN}[OK]${NC} Completado: $DESCRIPTION"
}

# ============================================
# IMPORTANTE: Reemplaza estos FILE_IDs con los IDs de tus archivos en Google Drive
# ============================================

# Para obtener el FILE_ID de Google Drive:
# 1. Sube tu carpeta/archivo a Google Drive
# 2. Haz clic derecho → Compartir → Obtener enlace
# 3. El enlace será: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
# 4. Copia solo el FILE_ID

# EJEMPLO de cómo obtener el FILE_ID:
# Si tu enlace es: https://drive.google.com/file/d/1abc123XYZ456/view?usp=sharing
# El FILE_ID es: 1abc123XYZ456

echo ""
echo -e "${YELLOW}[CONFIGURACIÓN]${NC} Por favor, configura los FILE_IDs en este script"
echo "Edita: scripts/download_images.sh"
echo ""

# ============================================
# Configuración de FILE_IDs (EDITAR AQUÍ)
# ============================================

# IMPORTANTE: Reemplaza "YOUR_FILE_ID_HERE" con los IDs reales de Google Drive

# Imágenes originales (150 imágenes JPG)
IMAGES_ORIGINAL_ID="YOUR_FILE_ID_HERE"

# Imágenes de segmentación - ADE20K Classes
IMAGES_SEG_ID="YOUR_FILE_ID_HERE"

# Imágenes de segmentación - ADE20K Groups
IMAGES_GROUP_ID="YOUR_FILE_ID_HERE"

# Imágenes de segmentación - ADE20K Disorder
IMAGES_DISORDER_ID="YOUR_FILE_ID_HERE"

# Imágenes de segmentación - ADE20K GroupDisorder
IMAGES_GROUP_DISORDER_ID="YOUR_FILE_ID_HERE"

# Datos CSV (opcional - puede ser grande)
DATA_CSV_ID="YOUR_FILE_ID_HERE"

# ============================================
# Descargar archivos
# ============================================

# Crear directorios necesarios
mkdir -p static/images/images/images
mkdir -p static/images/images/images_seg
mkdir -p static/images/images/ADE20K-Group/images
mkdir -p static/images/images/ADE20K-Disorder/images
mkdir -p static/images/images/ADE20K-GroupDisorder/images
mkdir -p static/data

# Verificar si gdown está instalado
if ! command -v gdown &> /dev/null; then
    echo -e "${YELLOW}[INFO]${NC} Instalando gdown para descargar desde Google Drive..."
    pip install -q gdown
fi

# Descargar imágenes originales
if [ "$IMAGES_ORIGINAL_ID" != "YOUR_FILE_ID_HERE" ]; then
    download_and_extract "$IMAGES_ORIGINAL_ID" "images_original.zip" "static/images/images/images" "Imágenes originales (150 JPG)"
else
    echo -e "${RED}[SKIP]${NC} FILE_ID no configurado para: Imágenes originales"
fi

# Descargar imágenes de segmentación - ADE20K Classes
if [ "$IMAGES_SEG_ID" != "YOUR_FILE_ID_HERE" ]; then
    download_and_extract "$IMAGES_SEG_ID" "images_seg.zip" "static/images/images/images_seg" "Segmentación ADE20K Classes"
else
    echo -e "${RED}[SKIP]${NC} FILE_ID no configurado para: Segmentación ADE20K Classes"
fi

# Descargar imágenes de segmentación - ADE20K Groups
if [ "$IMAGES_GROUP_ID" != "YOUR_FILE_ID_HERE" ]; then
    download_and_extract "$IMAGES_GROUP_ID" "images_group.zip" "static/images/images/ADE20K-Group/images" "Segmentación ADE20K Groups"
else
    echo -e "${RED}[SKIP]${NC} FILE_ID no configurado para: Segmentación ADE20K Groups"
fi

# Descargar imágenes de segmentación - ADE20K Disorder
if [ "$IMAGES_DISORDER_ID" != "YOUR_FILE_ID_HERE" ]; then
    download_and_extract "$IMAGES_DISORDER_ID" "images_disorder.zip" "static/images/images/ADE20K-Disorder/images" "Segmentación ADE20K Disorder"
else
    echo -e "${RED}[SKIP]${NC} FILE_ID no configurado para: Segmentación ADE20K Disorder"
fi

# Descargar imágenes de segmentación - ADE20K GroupDisorder
if [ "$IMAGES_GROUP_DISORDER_ID" != "YOUR_FILE_ID_HERE" ]; then
    download_and_extract "$IMAGES_GROUP_DISORDER_ID" "images_group_disorder.zip" "static/images/images/ADE20K-GroupDisorder/images" "Segmentación ADE20K GroupDisorder"
else
    echo -e "${RED}[SKIP]${NC} FILE_ID no configurado para: Segmentación ADE20K GroupDisorder"
fi

# Limpiar directorio temporal
rm -rf tmp

echo ""
echo -e "${GREEN}=========================================="
echo -e "  Descarga completada"
echo -e "==========================================${NC}"
echo ""
echo -e "${YELLOW}[INFO]${NC} Si saltaste descargas, edita este script y configura los FILE_IDs"
echo ""
