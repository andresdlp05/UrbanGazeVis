"""
Módulo compartido para servicios comunes entre controladores.
"""

# DataService - gestión de múltiples datasets
try:
    from .data_service import get_data_service, DataService
    print("✅ DataService importado correctamente")
except ImportError as e:
    print(f"❌ Advertencia: No se pudo importar DataService: {e}")
    get_data_service = None
    DataService = None

# PrecomputedFixationService
try:
    from .precomputed_fixation_service import (
        get_precomputed_service,
        get_fixations_ivt_fast,
        get_patch_fixations_fast,
        PrecomputedFixationService
    )
    print("✅ PrecomputedFixationService importado correctamente")
except ImportError as e:
    print(f"⚠️  Advertencia: No se pudo importar PrecomputedFixationService: {e}")
    get_precomputed_service = None
    get_fixations_ivt_fast = None
    get_patch_fixations_fast = None
    PrecomputedFixationService = None

# TSNECacheService
try:
    from .tsne_cache_service import get_tsne_cache
    print("✅ TSNECacheService importado correctamente")
except ImportError as e:
    print(f"⚠️  Advertencia: No se pudo importar TSNECacheService: {e}")
    get_tsne_cache = None

__all__ = [
    'get_data_service',
    'DataService',
    'get_precomputed_service',
    'get_fixations_ivt_fast',
    'get_patch_fixations_fast',
    'PrecomputedFixationService',
    'get_tsne_cache'
]