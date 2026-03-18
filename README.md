# TrackVis - Eye Tracking Visualization System

Sistema de visualización interactiva de datos de eye tracking con análisis de fijaciones, heatmaps y Radial Glyphs basado en Flask.

## Características principales

- Visualización de datos de eye tracking (gaze points y fixations)
- Heatmaps de atención visual
- Radial Glyphs interactivos con brush selection
- Análisis por participante con proyecciones t-SNE
- Detección de fijaciones mediante algoritmo I-VT
- Análisis de saliency coverage
- Scarf plots y visualizaciones temporales

## Requisitos previos

### Para todos los sistemas operativos

- **Docker Desktop** instalado y en ejecución
  - [Descargar Docker para Windows](https://docs.docker.com/desktop/install/windows-install/)
  - [Descargar Docker para Mac](https://docs.docker.com/desktop/install/mac-install/)
  - [Descargar Docker para Linux](https://docs.docker.com/desktop/install/linux-install/)
- **Git** instalado
  - [Descargar Git](https://git-scm.com/downloads)

## Instalación con Docker

### Windows

```bash
# 1. Clonar el repositorio
git clone https://github.com/FGV-VIS-2025/UrbanGazeVis.git

# 2. Navegar al directorio del proyecto
cd UrbanGazeVis

# 3. Construir y levantar los contenedores
docker-compose up -d --build

# 4. (Opcional) Ver los logs en tiempo real
docker-compose logs -f
```

### Linux

```bash
# 1. Clonar el repositorio
git clone https://github.com/FGV-VIS-2025/UrbanGazeVis.git

# 2. Navegar al directorio del proyecto
cd UrbanGazeVis

# 3. Construir y levantar los contenedores
docker-compose up -d --build

# 4. (Opcional) Ver los logs en tiempo real
docker-compose logs -f
```

### Mac

```bash
# 1. Clonar el repositorio
git clone https://github.com/FGV-VIS-2025/UrbanGazeVis.git

# 2. Navegar al directorio del proyecto
cd UrbanGazeVis

# 3. Construir y levantar los contenedores
docker-compose up -d --build

# 4. (Opcional) Ver los logs en tiempo real
docker-compose logs -f
```

## Acceder a la aplicación

Una vez que los contenedores estén en ejecución, abre tu navegador web y accede a:

**http://localhost:8081**

El sistema descargará automáticamente los datos necesarios la primera vez que se ejecute. Este proceso puede tardar varios minutos dependiendo de tu conexión a Internet.

## Comandos útiles de Docker

### Ver el estado de los contenedores

```bash
docker-compose ps
```

### Detener la aplicación

```bash
docker-compose down
```

### Detener y eliminar volúmenes (limpieza completa)

```bash
docker-compose down -v
```

### Reiniciar la aplicación

```bash
docker-compose restart
```

### Ver logs de la aplicación

```bash
# Ver todos los logs
docker-compose logs

# Ver logs en tiempo real
docker-compose logs -f

# Ver últimas 100 líneas
docker-compose logs --tail=100
```

### Reconstruir la imagen desde cero

```bash
docker-compose build --no-cache
docker-compose up -d
```


## Arquitectura del sistema

```
trackvis/
├── main.py                     # Aplicación Flask principal
├── docker-compose.yml          # Configuración de Docker
├── Dockerfile                  # Imagen de Docker
├── requirements.txt            # Dependencias Python
├── app/
│   ├── controllers/            # Controllers (blueprints de Flask)
│   │   ├── glyph.py           # Radial Glyph
│   │   ├── heatmap.py         # Heatmaps
│   │   ├── scarf_plot.py      # Scarf plots
│   │   └── by_participant.py  # Análisis por participante
│   ├── services/              # Servicios de negocio
│   │   └── fixation_detection_ivt.py  # Detección de fijaciones I-VT
│   └── shared/                # Servicios compartidos
│       └── tsne_cache_service.py      # Cache de proyecciones t-SNE
├── static/
│   ├── main.js                # JavaScript principal
│   ├── glyph_brush.js         # Glyph con brush D3.js
│   ├── styles.css             # Estilos CSS
│   ├── data/                  # Datos CSV/JSON
│   └── images/                # Imágenes del estudio
└── templates/
    └── index.html             # Template HTML principal
```



### El contenedor no inicia

```bash
# Verificar que Docker Desktop esté corriendo
docker --version

# Ver logs de error
docker-compose logs

# Reconstruir desde cero
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

### Error "port is already allocated"

El puerto 8081 está ocupado por otra aplicación. Puedes cambiar el puerto editando `docker-compose.yml`:

```yaml
ports:
  - "8082:8081"  # Cambia 8082 por el puerto que prefieras
```

### La descarga de datos falla

```bash
# Ver logs para identificar el error
docker-compose logs -f

# Reiniciar el contenedor
docker-compose restart

# Si el problema persiste, eliminar volúmenes y volver a crear
docker-compose down -v
docker-compose up -d --build
```

### La aplicación está lenta

- Los datos se procesan en tiempo real
- Para mejor performance:
  - Filtra por participante específico
  - Reduce el área del brush
  - Usa "Fixations" en lugar de "Gaze Points"

### No puedo acceder a http://localhost:8081

```bash
# Verificar que el contenedor esté corriendo
docker-compose ps

# Verificar que el puerto esté mapeado correctamente
docker-compose port trackvis 8081

# Verificar los logs del healthcheck
docker-compose logs trackvis | grep health
```

### Quiero limpiar todo y empezar de nuevo

```bash
# Detener y eliminar todo (contenedores, volúmenes, imágenes)
docker-compose down -v
docker system prune -a

# Volver a construir
docker-compose up -d --build
```


############### 
Modulos verificados 

mixed_table_generator
mixedEffectsResults
generate_precalculated_fixations

falta hacer el modulo para 
C:\Users\vdela\Desktop\UrbanGazeVis\README.md

"C:\Users\vdela\UrbanGazeVis"