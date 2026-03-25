#!/bin/bash

# Script de inicio para Linux/Mac
# TrackVis - Eye Tracking Visualization System

echo "ðŸš€ Iniciando TrackVis..."
echo ""

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar si Python estÃ¡ instalado
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}âŒ Error: Python 3 no estÃ¡ instalado${NC}"
    echo "Por favor instala Python 3.8 o superior"
    exit 1
fi

echo -e "${GREEN}âœ… Python encontrado:${NC} $(python3 --version)"

# Verificar si el entorno virtual existe
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}âš ï¸  Entorno virtual no encontrado. Creando...${NC}"
    python3 -m venv venv
    echo -e "${GREEN}âœ… Entorno virtual creado${NC}"
fi

# Activar entorno virtual
echo -e "${YELLOW}ðŸ“¦ Activando entorno virtual...${NC}"
source venv/bin/activate

# Verificar si las dependencias estÃ¡n instaladas
if ! python3 -c "import flask" &> /dev/null; then
    echo -e "${YELLOW}âš ï¸  Dependencias no encontradas. Instalando...${NC}"
    pip install -r requirements.txt
    echo -e "${GREEN}âœ… Dependencias instaladas${NC}"
fi

# Verificar que existan los archivos de datos
if [ ! -f "static/data/csv/df_final1.csv" ]; then
    echo -e "${RED}âŒ Error: Archivo df_final1.csv no encontrado${NC}"
    echo "Por favor descarga los datos necesarios en static/data/"
    echo "Ver README.md para mÃ¡s informaciÃ³n"
    exit 1
fi

if [ ! -f "static/data/csv/ivt_precalculated.csv" ]; then
    echo -e "${RED}âŒ Error: Archivo ivt_precalculated.csv no encontrado${NC}"
    echo "Por favor descarga los datos necesarios en static/data/"
    echo "Ver README.md para mÃ¡s informaciÃ³n"
    exit 1
fi

echo -e "${GREEN}âœ… Archivos de datos encontrados${NC}"
echo ""
echo -e "${GREEN}ðŸŽ‰ Iniciando servidor Flask...${NC}"
echo -e "${YELLOW}ðŸ“ URL: http://localhost:8081${NC}"
echo ""
echo "Presiona Ctrl+C para detener el servidor"
echo ""

# Iniciar la aplicaciÃ³n
python3 main2.py

