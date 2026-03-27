#!/bin/bash

# Startup script for Linux/Mac
# TrackVis - Eye Tracking Visualization System

set -e

echo "Starting TrackVis..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check Python
if ! command -v python3 >/dev/null 2>&1; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    echo "Install Python 3.8+ first"
    exit 1
fi

echo -e "${GREEN}Python found:${NC} $(python3 --version)"

# Create venv if missing
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Virtualenv not found. Creating...${NC}"
    python3 -m venv venv
    echo -e "${GREEN}Virtualenv created${NC}"
fi

# Activate venv
echo -e "${YELLOW}Activating virtualenv...${NC}"
source venv/bin/activate

# Install dependencies if needed
if ! python3 -c "import flask" >/dev/null 2>&1; then
    echo -e "${YELLOW}Dependencies missing. Installing...${NC}"
    pip install -r requirements.txt
    echo -e "${GREEN}Dependencies installed${NC}"
fi

# Validate local CSV files only in local mode
CSV_SOURCE_MODE="${CSV_SOURCE_MODE:-remote}"
if [ "$CSV_SOURCE_MODE" = "local" ]; then
    if [ ! -f "static/data/csv/df_final1.csv" ]; then
        echo -e "${RED}Error: df_final1.csv not found${NC}"
        echo "Download required data under static/data/"
        exit 1
    fi

    if [ ! -f "static/data/csv/ivt_precalculated.csv" ]; then
        echo -e "${RED}Error: ivt_precalculated.csv not found${NC}"
        echo "Download required data under static/data/"
        exit 1
    fi

    echo -e "${GREEN}Local CSV files found${NC}"
else
    echo -e "${GREEN}Remote CSV mode enabled (CSV_SOURCE_MODE=${CSV_SOURCE_MODE})${NC}"
fi

echo ""
echo -e "${GREEN}Starting Flask server...${NC}"
echo -e "${YELLOW}URL: http://localhost:8081${NC}"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start app
python3 main2.py
