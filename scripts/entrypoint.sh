#!/bin/bash

# Entrypoint script para Docker container
# Descarga automáticamente datos desde Google Drive si no existen

set -e

echo "=========================================="
echo "  TrackVis - Docker Container Starting"
echo "=========================================="
echo ""

# Verificar si los datos ya existen
DATA_EXISTS=false

if [ -f "/app/static/data/df_final1.csv" ] && \
   [ -f "/app/static/images/images/images/0.jpg" ] && \
   [ -f "/app/static/images/images/images_seg/0.png" ]; then
    echo "✅ Datos encontrados, saltando descarga"
    DATA_EXISTS=true
else
    echo "⚠️  Datos no encontrados, iniciando descarga desde Google Drive..."
    echo ""
fi

# Si los datos no existen, descargarlos
if [ "$DATA_EXISTS" = false ]; then
    # Verificar si el script de descarga existe
    if [ -f "/app/scripts/download_images_configured.sh" ]; then
        echo "Ejecutando script de descarga..."
        bash /app/scripts/download_images_configured.sh
    else
        echo "❌ ERROR: Script de descarga no encontrado"
        echo "   Por favor, descarga los datos manualmente antes de ejecutar Docker"
        echo ""
        echo "   Ejecuta: ./scripts/download_images_configured.sh"
        echo ""
        exit 1
    fi
fi

echo ""
echo "=========================================="
echo "  ✅ Datos listos"
echo "=========================================="
echo ""
echo "🚀 Iniciando servidor Flask..."
echo "   Puerto: 8081"
echo "   Acceder a: http://localhost:8081"
echo ""

# Ejecutar el comando proporcionado (por defecto: python main.py)
exec "$@"
