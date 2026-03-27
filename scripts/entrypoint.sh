#!/bin/bash

# Entrypoint script for Docker

set -e

echo "=========================================="
echo "  TrackVis - Docker Container Starting"
echo "=========================================="
echo ""

DATA_EXISTS=false
CSV_SOURCE_MODE="${CSV_SOURCE_MODE:-remote}"

if [ "$CSV_SOURCE_MODE" = "local" ] && \
   [ -f "/app/static/data/csv/df_final1.csv" ] && \
   [ -f "/app/static/images/images/images/0.jpg" ] && \
   [ -f "/app/static/images/images/images_seg/0.png" ]; then
    echo "Data files found (local mode), skipping download"
    DATA_EXISTS=true
elif [ "$CSV_SOURCE_MODE" != "local" ] && \
     [ -f "/app/static/images/images/images/0.jpg" ] && \
     [ -f "/app/static/images/images/images_seg/0.png" ]; then
    echo "Images found and remote CSV mode enabled ($CSV_SOURCE_MODE), skipping download"
    DATA_EXISTS=true
else
    echo "Missing required assets, starting download from Google Drive..."
    echo ""
fi

if [ "$DATA_EXISTS" = false ]; then
    if [ -f "/app/scripts/download_images_configured.sh" ]; then
        echo "Running data download script..."
        bash /app/scripts/download_images_configured.sh
    else
        echo "ERROR: download script not found"
        echo "Run: ./scripts/download_images_configured.sh"
        exit 1
    fi
fi

echo ""
echo "=========================================="
echo "  Data ready"
echo "=========================================="
echo ""
echo "Starting Flask server..."
echo "Port: 8081"
echo "URL: http://localhost:8081"
echo ""

exec "$@"
