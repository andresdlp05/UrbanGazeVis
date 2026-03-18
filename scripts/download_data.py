#!/usr/bin/env python3
"""
Script para descargar datos desde Google Drive automáticamente
Funciona en Windows, Linux y Mac
"""
import os
import subprocess
import sys
import zipfile

# Configuración de archivos a descargar
FILES_TO_DOWNLOAD = [
    {
        'file_id': '1VKLKNJts-bRPuXT3i34NpPLjF-RksI9G',
        'output': 'static/data.zip',
        'extract_to': 'static/data',
        'check_file': 'static/data/df_final1.csv'
    },
    {
        'file_id': '14rCekowQUwjdVTEyRvDkbPpYRgRiXYuZ',
        'output': 'static/images.zip',
        'extract_to': 'static/images/images/images',
        'check_file': 'static/images/images/images/ADE_train_00000001.jpg'
    },
    {
        'file_id': '1uMGA7TJia_VDh5sFz0gGSFU9vNuEAQop',
        'output': 'static/images_seg.zip',
        'extract_to': 'static/images/images/images_seg',
        'check_file': 'static/images/images/images_seg/ADE_train_00000001.png'
    },
    {
        'file_id': '1P5axVPdDNwCuaXIlWpTwdQ408RFt_HQm',
        'output': 'static/ADE20K-Group.zip',
        'extract_to': 'static/images/images/ADE20K-Group',
        'check_file': 'static/images/images/ADE20K-Group/images/ADE_train_00000001.jpg'
    },
    {
        'file_id': '1tbY9eN_WOS3-1RD5lziXB_4RS3TowLzM',
        'output': 'static/ADE20K-Disorder.zip',
        'extract_to': 'static/images/images/ADE20K-Disorder',
        'check_file': 'static/images/images/ADE20K-Disorder/images/ADE_train_00000001.jpg'
    },
    {
        'file_id': '1sjLgAjqbX0by5x-8VkSQWoqWORrC5Uxr',
        'output': 'static/ADE20K-GroupDisorder.zip',
        'extract_to': 'static/images/images/ADE20K-GroupDisorder',
        'check_file': 'static/images/images/ADE20K-GroupDisorder/images/ADE_train_00000001.jpg'
    }
]

def check_file_exists(filepath):
    """Verifica si un archivo existe"""
    return os.path.exists(filepath)

def download_file(file_id, output_path):
    """Descarga un archivo desde Google Drive usando gdown"""
    print(f"📥 Descargando {output_path}...")
    try:
        subprocess.run(
            ['gdown', f'https://drive.google.com/uc?id={file_id}', '-O', output_path],
            check=True
        )
        print(f"✅ Descarga completada: {output_path}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Error descargando {output_path}: {e}")
        return False

def extract_zip(zip_path, extract_to):
    """Extrae un archivo ZIP, manejando posibles directorios raíz dentro del zip"""
    print(f"📦 Extrayendo {zip_path} a {extract_to}...")
    try:
        os.makedirs(extract_to, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            
            # Obtener todos los nombres de archivo
            namelist = zip_ref.namelist()
            
            # Intentar identificar un directorio raíz único
            root_dir = ""
            if len(namelist) > 1 and namelist[0].endswith('/'):
                # Si el primer elemento es un directorio, asumirlo como la raíz
                root_dir = namelist[0]
            
            # Iterar y extraer, quitando el prefijo del directorio raíz si existe
            for member in namelist:
                target_path = member
                
                # Quitar el prefijo del directorio raíz
                if member.startswith(root_dir) and root_dir:
                    target_path = member[len(root_dir):]
                
                # Evitar procesar la entrada de directorio raíz en sí misma (si fue identificada)
                if not target_path:
                    continue
                    
                # Crear la ruta de destino final
                f_target = os.path.join(extract_to, target_path)

                # Asegurarse de que el directorio exista para la extracción
                f_dir = os.path.dirname(f_target)
                if f_dir:
                    os.makedirs(f_dir, exist_ok=True)
                
                # Extraer solo si no es una entrada de directorio que ya manejamos
                if not member.endswith('/'):
                    source = zip_ref.open(member)
                    target = open(f_target, "wb")
                    with source, target:
                        target.write(source.read())

        print(f"✅ Extracción completada: {extract_to}")
        # Eliminar el ZIP después de extraer
        os.remove(zip_path)
        print(f"🗑️  Archivo ZIP eliminado: {zip_path}")
        return True
    except Exception as e:
        print(f"❌ Error extrayendo {zip_path}: {e}")
        return False

def main():
    """Función principal"""
    print("=" * 60)
    print("🚀 Verificando y descargando datos necesarios...")
    print("=" * 60)

    all_files_exist = True

    # Verificar qué archivos faltan
    for file_info in FILES_TO_DOWNLOAD:
        if not check_file_exists(file_info['check_file']):
            all_files_exist = False
            print(f"⚠️  Falta: {file_info['check_file']}")
        else:
            print(f"✅ Existe: {file_info['check_file']}")

    if all_files_exist:
        print("\n✅ Todos los archivos de datos ya existen. Saltando descarga.")
        print("=" * 60)
        return 0

    # Descargar y extraer archivos faltantes
    print("\n📥 Iniciando descarga de archivos faltantes...")

    for file_info in FILES_TO_DOWNLOAD:
        if check_file_exists(file_info['check_file']):
            print(f"⏭️  Saltando {file_info['output']} (ya existe)")
            continue

        # Descargar
        if not download_file(file_info['file_id'], file_info['output']):
            print(f"❌ Error crítico descargando {file_info['output']}")
            return 1

        # Extraer
        if not extract_zip(file_info['output'], file_info['extract_to']):
            print(f"❌ Error crítico extrayendo {file_info['output']}")
            return 1

    print("\n" + "=" * 60)
    print("✅ Descarga y extracción completadas exitosamente")
    print("=" * 60)
    return 0

if __name__ == '__main__':
    sys.exit(main())