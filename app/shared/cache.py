"""
Instancia compartida de Flask-Caching.
Se inicializa en main.py con cache.init_app(app).
"""
from flask_caching import Cache

cache = Cache()
