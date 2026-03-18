# TrackVis - Eye Tracking Visualization System
# Dockerfile para deployment multiplataforma con descarga automática de datos

FROM python:3.11-slim

# Metadata
LABEL maintainer="TrackVis Team"
LABEL description="Interactive Eye Tracking Visualization System"
LABEL version="2.0"

# Configurar variables de entorno
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=main.py
ENV FLASK_ENV=production

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar requirements.txt primero (para aprovechar cache de Docker)
COPY requirements.txt .

# Instalar dependencias de Python
RUN pip install --no-cache-dir -r requirements.txt

# Instalar gdown para descargar desde Google Drive
RUN pip install --no-cache-dir gdown

# Copiar código de la aplicación
COPY . .

# Crear directorios necesarios
RUN mkdir -p static/images/images/images \
    static/images/images/images_seg \
    static/images/images/ADE20K-Group/images \
    static/images/images/ADE20K-Disorder/images \
    static/images/images/ADE20K-GroupDisorder/images \
    static/data

# Exponer puerto
EXPOSE 8081

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8081/ || exit 1

# Comando de inicio directo
CMD ["sh", "-c", "python scripts/download_data.py && python main.py"]
#CMD ["python", "main.py"]
