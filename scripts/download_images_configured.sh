#!/bin/bash

# Script configurado con FILE_IDs reales de Google Drive
# TrackVis - Eye Tracking Visualization System

set -e  # Salir si hay error

echo "=========================================="
echo "  TrackVis - Descargando datos desde Google Drive"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# ============================================
# FILE_IDs configurados
# ============================================

DATA_ZIP_ID="1VKLKNJts-bRPuXT3i34NpPLjF-RksI9G"
IMAGES_ORIGINAL_ID="14rCekowQUwjdVTEyRvDkbPpYRgRiXYuZ"
IMAGES_SEG_ID="1uMGA7TJia_VDh5sFz0gGSFU9vNuEAQop"
DATOS_SEG_ID="1ohj_ZldEcAT4zNW0Nxc-Wb0saYSwoAi3"
IMAGES_GROUP_ID="1P5axVPdDNwCuaXIlWpTwdQ408RFt_HQm"
IMAGES_DISORDER_ID="1tbY9eN_WOS3-1RD5lziXB_4RS3TowLzM"
IMAGES_GROUP_DISORDER_ID="1sjLgAjqbX0by5x-8VkSQWoqWORrC5Uxr"

# ============================================
# Función para descargar y extraer
# ============================================

download_and_extract() {
    local FILE_ID=$1
    local ZIP_NAME=$2
    local EXTRACT_PATH=$3
    local DESCRIPTION=$4

    echo -e "${YELLOW}[INFO]${NC} $DESCRIPTION"

    # Verificar si ya existe
    if [ -d "$EXTRACT_PATH" ] && [ "$(ls -A $EXTRACT_PATH 2>/dev/null)" ]; then
        echo -e "${GREEN}[OK]${NC} Ya existe: $EXTRACT_PATH"
        return 0
    fi

    # Crear directorio si no existe
    mkdir -p "$(dirname $EXTRACT_PATH)"
    mkdir -p tmp

    # Instalar gdown si no está
    if ! command -v gdown &> /dev/null; then
        echo -e "${YELLOW}[INFO]${NC} Instalando gdown..."
        pip install -q gdown
    fi

    # Descargar
    echo -e "${YELLOW}[INFO]${NC} Descargando $ZIP_NAME..."
    if gdown "https://drive.google.com/uc?id=$FILE_ID" -O "tmp/$ZIP_NAME"; then
        echo -e "${GREEN}[OK]${NC} Descargado: $ZIP_NAME"
    else
        echo -e "${RED}[ERROR]${NC} Fallo al descargar: $ZIP_NAME"
        return 1
    fi

    # Extraer
    echo -e "${YELLOW}[INFO]${NC} Extrayendo a $EXTRACT_PATH..."
    mkdir -p "$EXTRACT_PATH"
    unzip -q "tmp/$ZIP_NAME" -d "$EXTRACT_PATH"

    # Limpiar
    rm -f "tmp/$ZIP_NAME"

    echo -e "${GREEN}[OK]${NC} Completado: $DESCRIPTION"
}

# ============================================
# Crear directorios
# ============================================

mkdir -p static/data
mkdir -p static/images/images/images
mkdir -p static/images/images/images_seg
mkdir -p static/images/images/ADE20K-Group/images
mkdir -p static/images/images/ADE20K-Disorder/images
mkdir -p static/images/images/ADE20K-GroupDisorder/images

# ============================================
# Descargar archivos
# ============================================

# 1. Data (CSV files)
download_and_extract "$DATA_ZIP_ID" "data.zip" "static/data" "📊 Datos CSV"

# 2. Imágenes originales
download_and_extract "$IMAGES_ORIGINAL_ID" "images.zip" "static/images/images/images" "🖼️  Imágenes originales"

# 3. Imágenes de segmentación - ADE20K Classes
download_and_extract "$IMAGES_SEG_ID" "images_seg.zip" "static/images/images/images_seg" "🎨 Segmentación ADE20K Classes"

# 4. Datos de segmentación adicionales (si se necesitan)
# download_and_extract "$DATOS_SEG_ID" "datos_seg.zip" "static/images/images/datos_seg" "📁 Datos de segmentación"

# 5. Imágenes de segmentación - ADE20K Groups
download_and_extract "$IMAGES_GROUP_ID" "ADE20K-Group.zip" "static/images/images/ADE20K-Group/images" "🏗️  Segmentación ADE20K Groups"

# 6. Imágenes de segmentación - ADE20K Disorder
download_and_extract "$IMAGES_DISORDER_ID" "ADE20K-Disorder.zip" "static/images/images/ADE20K-Disorder/images" "⚠️  Segmentación ADE20K Disorder"

# 7. Imágenes de segmentación - ADE20K GroupDisorder
download_and_extract "$IMAGES_GROUP_DISORDER_ID" "ADE20K-GroupDisorder.zip" "static/images/images/ADE20K-GroupDisorder/images" "🔀 Segmentación ADE20K GroupDisorder"

# ============================================
# Limpiar
# ============================================

rm -rf tmp

echo ""
echo -e "${GREEN}=========================================="
echo -e "  ✅ Descarga completada exitosamente"
echo -e "==========================================${NC}"
echo ""
echo -e "${YELLOW}[INFO]${NC} Verificando archivos descargados..."
echo ""

# Verificar que existan archivos
if [ -f "static/data/df_final1.csv" ]; then
    echo -e "${GREEN}[OK]${NC} Datos CSV encontrados"
else
    echo -e "${RED}[WARN]${NC} Datos CSV no encontrados"
fi

if [ -f "static/images/images/images/0.jpg" ]; then
    echo -e "${GREEN}[OK]${NC} Imágenes originales encontradas"
else
    echo -e "${RED}[WARN]${NC} Imágenes originales no encontradas"
fi

if [ -f "static/images/images/images_seg/0.JPEG" ]; then
    echo -e "${GREEN}[OK]${NC} Segmentación ADE20K Classes encontrada"
else
    echo -e "${RED}[WARN]${NC} Segmentación ADE20K Classes no encontrada"
fi

if [ -f "static/images/images/ADE20K-Group/images/0.png" ]; then
    echo -e "${GREEN}[OK]${NC} Segmentación ADE20K Groups encontrada"
else
    echo -e "${RED}[WARN]${NC} Segmentación ADE20K Groups no encontrada"
fi

echo ""
echo -e "${GREEN}[INFO]${NC} Listo para ejecutar: ${YELLOW}docker-compose up -d${NC}"
echo ""
