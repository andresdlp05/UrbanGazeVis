"""
DataService - Servicio singleton para gestionar múltiples datasets
Permite cargar diferentes CSVs según el tipo de segmentación seleccionado
"""

import pandas as pd
import os
import json

class DataService:
    """Singleton para gestionar múltiples datasets de eye tracking"""

    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataService, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if not self._initialized:
            self.base_path = os.path.join(os.path.dirname(__file__), '..', '..')
            self.data_cache = {}  # Cache de datasets cargados
            self.scores_data = None
            self._load_scores()
            self._initialized = True

    def _load_scores(self):
        """Carga scores de participantes (común para todos los datasets)"""
        try:
            scores_path = os.path.join(self.base_path, 'static', 'data', 'data_hololens.json')
            if os.path.exists(scores_path):
                with open(scores_path, 'r') as f:
                    self.scores_data = json.load(f)
                print(f"DataService: Scores cargados ({len(self.scores_data)} imágenes)")
            else:
                print(f"ADVERTENCIA: DataService: Archivo de scores no encontrado en {scores_path}")
        except Exception as e:
            print(f"Error cargando scores: {e}")

    def get_scores_data(self):
        """Retorna los scores de participantes"""
        return self.scores_data

    def get_main_data(self):
        """Retorna el dataset principal (main_class = df_final1.csv)"""
        return self.get_data_by_dataset('main_class')

    def get_data_by_dataset(self, dataset_select='main_class'):
        """
        Carga y retorna el DataFrame correcto según el dataset seleccionado

        Args:
            dataset_select: 'main_class', 'grouped', 'disorder', o 'grouped_disorder'

        Returns:
            DataFrame con los datos del dataset seleccionado
        """
        # Mapeo de dataset a archivo CSV
        dataset_files = {
            'main_class': 'static/data/df_final1.csv',
            'grouped': 'static/data/FINAL_Group.csv',
            'disorder': 'static/data/FINAL_20kDisorder.csv',
            'grouped_disorder': 'static/data/FINAL_GroupDisorder.csv'
        }

        # Validar dataset_select
        if dataset_select not in dataset_files:
            print(f"ADVERTENCIA: Dataset '{dataset_select}' no reconocido, usando 'main_class'")
            dataset_select = 'main_class'

        # Verificar si ya está en cache
        if dataset_select in self.data_cache:
            print(f"DataService: Usando cache para dataset '{dataset_select}'")
            return self.data_cache[dataset_select]

        # Cargar dataset
        csv_path = dataset_files[dataset_select]
        full_path = os.path.join(self.base_path, csv_path)

        try:
            print(f"DataService: Cargando dataset '{dataset_select}' desde {csv_path}...")
            df = pd.read_csv(full_path)

            # Guardar en cache
            self.data_cache[dataset_select] = df

            print(f"✅ DataService: Dataset '{dataset_select}' cargado ({len(df)} filas, {len(df.columns)} columnas)")

            # Mostrar columnas disponibles para debug
            if 'main_class' in df.columns:
                print(f"   Columnas encontradas: main_class ✅")
            if 'group' in df.columns:
                print(f"   Columnas encontradas: group ✅")
            elif 'group_name' in df.columns:
                print(f"   Columnas encontradas: group_name ✅")
            elif 'grupo' in df.columns:
                print(f"   Columnas encontradas: grupo ✅")

            return df

        except FileNotFoundError:
            print(f"❌ ERROR: Archivo no encontrado: {full_path}")
            print(f"   Asegúrate de que el archivo existe o descarga los datos necesarios")

            # Fallback a main_class si el archivo no existe
            if dataset_select != 'main_class':
                print(f"   Usando fallback a 'main_class'...")
                return self.get_data_by_dataset('main_class')

            return None

        except Exception as e:
            print(f"❌ ERROR cargando dataset '{dataset_select}': {e}")

            # Fallback a main_class en caso de error
            if dataset_select != 'main_class':
                print(f"   Usando fallback a 'main_class'...")
                return self.get_data_by_dataset('main_class')

            return None

    def clear_cache(self, dataset_select=None):
        """
        Limpia el cache de datasets

        Args:
            dataset_select: Si se especifica, solo limpia ese dataset.
                          Si es None, limpia todo el cache.
        """
        if dataset_select:
            if dataset_select in self.data_cache:
                del self.data_cache[dataset_select]
                print(f"DataService: Cache limpiado para '{dataset_select}'")
        else:
            self.data_cache.clear()
            print("DataService: Todo el cache limpiado")

    def get_available_datasets(self):
        """Retorna lista de datasets disponibles"""
        return ['main_class', 'grouped', 'disorder', 'grouped_disorder']

    def dataset_info(self, dataset_select='main_class'):
        """Muestra información sobre un dataset"""
        df = self.get_data_by_dataset(dataset_select)

        if df is None:
            return f"Dataset '{dataset_select}' no disponible"

        info = f"\n=== Dataset: {dataset_select} ==="
        info += f"\nFilas: {len(df)}"
        info += f"\nColumnas: {list(df.columns)}"
        info += f"\nParticipantes únicos: {df['participante'].nunique() if 'participante' in df.columns else 'N/A'}"
        info += f"\nImágenes únicas: {df['ImageName'].nunique() if 'ImageName' in df.columns else 'N/A'}"

        return info


# Función helper para obtener la instancia del servicio
def get_data_service():
    """Retorna la instancia singleton del DataService"""
    return DataService()


# Ejemplo de uso
if __name__ == '__main__':
    # Test del servicio
    service = get_data_service()

    print("\n=== Testing DataService ===\n")

    # Test main_class
    df_main = service.get_data_by_dataset('main_class')
    print(f"\nmain_class: {len(df_main) if df_main is not None else 'ERROR'} filas")

    # Test grouped
    df_grouped = service.get_data_by_dataset('grouped')
    print(f"grouped: {len(df_grouped) if df_grouped is not None else 'ERROR'} filas")

    # Test disorder
    df_disorder = service.get_data_by_dataset('disorder')
    print(f"disorder: {len(df_disorder) if df_disorder is not None else 'ERROR'} filas")

    # Test grouped_disorder
    df_grouped_disorder = service.get_data_by_dataset('grouped_disorder')
    print(f"grouped_disorder: {len(df_grouped_disorder) if df_grouped_disorder is not None else 'ERROR'} filas")

    # Info de dataset
    print(service.dataset_info('main_class'))
