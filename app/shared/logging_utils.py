import os


BACKEND_DEBUG_LOGS = str(os.environ.get('BACKEND_DEBUG_LOGS', '0')).lower() in ['1', 'true', 'yes']


def debug_log(*args, **kwargs):
    if BACKEND_DEBUG_LOGS:
        print(*args, **kwargs)


def error_log(*args, **kwargs):
    print(*args, **kwargs)
