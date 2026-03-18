"""
Servicio de caché para t-SNE projections
Evita recalcular t-SNE multiple veces (que tarda 30-60 segundos)
"""

import os
import json
import numpy as np
from datetime import datetime, timedelta

class TSNECacheService:
    """Servicio para cachear y reutilizar cálculos de t-SNE"""
    _instance = None

    def __init__(self):
        self.cache = {}  # {participant_id: {embeddings_hash: tsne_result}}
        self.cache_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'cache', 'tsne')
        self.cache_expiry = timedelta(hours=24)  # Cache válido por 24 horas
        self._load_disk_cache()

    @classmethod
    def getInstance(cls):
        """Retorna la instancia singleton"""
        if cls._instance is None:
            cls._instance = TSNECacheService()
        return cls._instance

    def _load_disk_cache(self):
        """Carga el caché desde disco si existe"""
        loaded_count = 0
        if os.path.exists(self.cache_dir):
            try:
                for file in os.listdir(self.cache_dir):
                    if file.endswith('.json'):
                        try:
                            with open(os.path.join(self.cache_dir, file), 'r') as f:
                                data = json.load(f)
                                participant_id = int(file.split('_')[1].replace('.json', ''))
                                # Guardar el resultado del caché (puede ser 'result' o 'tsne_result')
                                tsne_result = data.get('result') or data.get('tsne_result')
                                if tsne_result:
                                    self.cache[participant_id] = tsne_result
                                    loaded_count += 1
                        except (ValueError, json.JSONDecodeError, KeyError) as e:
                            print(f"ADVERTENCIA: Error cargando archivo {file}: {e}")
                            continue

                if loaded_count > 0:
                    print(f"TSNECache: {loaded_count} caches precalculados cargados desde disco")
            except Exception as e:
                print(f"ADVERTENCIA: TSNECache: Error cargando cache desde disco: {e}")

    def _ensure_cache_dir(self):
        """Asegura que existe el directorio de caché"""
        os.makedirs(self.cache_dir, exist_ok=True)

    def _hash_embeddings(self, embeddings):
        """Genera un hash de los embeddings para detectar cambios"""
        if isinstance(embeddings, np.ndarray):
            embeddings_list = embeddings.tolist()
        else:
            embeddings_list = embeddings

        # Hash simple basado en forma y suma
        shape_hash = str(np.array(embeddings_list).shape)
        sum_hash = str(np.array(embeddings_list).sum())
        return f"{shape_hash}_{sum_hash}"

    def get(self, participant_id, embeddings):
        """
        Obtiene resultado de t-SNE del caché si existe
        Retorna None si no está en caché
        """
        if participant_id in self.cache:
            cached = self.cache[participant_id]
            # El caché precalculado no tiene hash, solo el resultado
            # Por eso retornamos directamente si existe
            if isinstance(cached, dict) and ('x' in cached or 'result' in cached):
                print(f"TSNECache HIT: Usando cache para participante {participant_id}")
                return cached
            # Si es un dict con estructura antigua (con hash)
            elif isinstance(cached, dict) and 'result' in cached:
                return cached.get('result')

        return None

    def set(self, participant_id, embeddings, tsne_result):
        """
        Guarda resultado de t-SNE en caché (en memoria y disco)
        """
        try:
            embeddings_hash = self._hash_embeddings(embeddings)

            cache_entry = {
                'hash': embeddings_hash,
                'result': {
                    'x': tsne_result['x'].tolist() if isinstance(tsne_result['x'], np.ndarray) else tsne_result['x'],
                    'y': tsne_result['y'].tolist() if isinstance(tsne_result['y'], np.ndarray) else tsne_result['y'],
                    'timestamp': datetime.now().isoformat()
                },
                'timestamp': datetime.now().isoformat()
            }

            # Guardar en caché en memoria
            self.cache[participant_id] = cache_entry

            # Guardar en disco
            self._ensure_cache_dir()
            cache_file = os.path.join(self.cache_dir, f'tsne_{participant_id}.json')
            with open(cache_file, 'w') as f:
                json.dump(cache_entry, f, indent=2)

            print(f"✅ TSNECache: Resultado cacheado para participante {participant_id}")
        except Exception as e:
            print(f"⚠️ TSNECache: Error guardando caché: {e}")

    def clear_participant(self, participant_id):
        """Limpia caché para un participante específico"""
        if participant_id in self.cache:
            del self.cache[participant_id]

        cache_file = os.path.join(self.cache_dir, f'tsne_{participant_id}.json')
        if os.path.exists(cache_file):
            os.remove(cache_file)
            print(f"✅ TSNECache: Caché limpiado para participante {participant_id}")

    def clear_all(self):
        """Limpia todo el caché"""
        self.cache.clear()
        if os.path.exists(self.cache_dir):
            import shutil
            shutil.rmtree(self.cache_dir)
        print(f"✅ TSNECache: Todos los cachés eliminados")


def get_tsne_cache():
    """Retorna la instancia singleton del caché de t-SNE"""
    return TSNECacheService.getInstance()
