import os
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd

from app.shared.logging_utils import debug_log, error_log

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CSV_BASE_URL = "https://pub-95dc43debe9a4ef681470f6ad069a62c.r2.dev/csv"
_csv_base_url = os.environ.get("CSV_BASE_URL", DEFAULT_CSV_BASE_URL).strip().rstrip("/")

KNOWN_CSV_FILES = {
    "df_final1.csv",
    "ivt_precalculated.csv",
    "precalculated_fixations.csv",
    "precalculated_saliency_coverage.csv",
    "upd_segmentations.csv",
}

CSV_URLS = {
    "df_final1.csv": os.environ.get("CSV_URL_DF_FINAL1", f"{_csv_base_url}/df_final1.csv"),
    "ivt_precalculated.csv": os.environ.get("CSV_URL_IVT_PRECALCULATED", f"{_csv_base_url}/ivt_precalculated.csv"),
    "precalculated_fixations.csv": os.environ.get(
        "CSV_URL_PRECALCULATED_FIXATIONS", f"{_csv_base_url}/precalculated_fixations.csv"
    ),
    "precalculated_saliency_coverage.csv": os.environ.get(
        "CSV_URL_PRECALCULATED_SALIENCY_COVERAGE", f"{_csv_base_url}/precalculated_saliency_coverage.csv"
    ),
    "upd_segmentations.csv": os.environ.get("CSV_URL_UPD_SEGMENTATIONS", f"{_csv_base_url}/upd_segmentations.csv"),
}

DEFAULT_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/csv,*/*;q=0.9",
}


def is_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https")


def _normalize_mode(mode):
    raw_mode = (mode or os.environ.get("CSV_SOURCE_MODE", "remote")).strip().lower()
    if raw_mode not in {"remote", "local", "auto", "url"}:
        return "remote"
    if raw_mode == "url":
        return "remote"
    return raw_mode


def get_local_csv_path(filename, base_path=None):
    root = Path(base_path) if base_path else PROJECT_ROOT
    return str(root / "static" / "data" / "csv" / filename)


def get_remote_csv_url(filename):
    if filename not in CSV_URLS:
        raise KeyError(f"CSV filename not registered: {filename}")
    return CSV_URLS[filename]


def get_csv_source(filename, mode=None, base_path=None):
    selected_mode = _normalize_mode(mode)
    local_source = get_local_csv_path(filename, base_path=base_path)
    remote_source = get_remote_csv_url(filename)

    if selected_mode == "local":
        return local_source
    if selected_mode == "auto":
        return local_source if os.path.exists(local_source) else remote_source
    return remote_source


def get_csv_source_mode(mode=None):
    return _normalize_mode(mode)


def get_csv_source_map(mode=None, base_path=None):
    return {filename: get_csv_source(filename, mode=mode, base_path=base_path) for filename in sorted(KNOWN_CSV_FILES)}


def log_csv_source_configuration(mode=None, base_path=None, logger=print):
    selected_mode = _normalize_mode(mode)
    if selected_mode == "local":
        mode_label = "local CSV files"
    elif selected_mode == "auto":
        mode_label = "auto (local if exists, else bucket)"
    else:
        mode_label = "bucket URLs"

    logger(f"[CSV CONFIG] mode={selected_mode} -> {mode_label}")
    for filename, source in get_csv_source_map(mode=selected_mode, base_path=base_path).items():
        source_kind = "bucket" if is_url(source) else "local"
        logger(f"[CSV CONFIG] {filename}: {source_kind} -> {source}")


def _prepare_read_csv_kwargs(source, read_csv_kwargs):
    kwargs = dict(read_csv_kwargs)
    if not is_url(source):
        return kwargs

    existing_storage_options = kwargs.get("storage_options") or {}
    merged_storage_options = dict(DEFAULT_HTTP_HEADERS)
    merged_storage_options.update(existing_storage_options)
    kwargs["storage_options"] = merged_storage_options
    return kwargs


def _read_csv_with_source(source, **read_csv_kwargs):
    kwargs = _prepare_read_csv_kwargs(source, read_csv_kwargs)
    return pd.read_csv(source, **kwargs)


def resolve_source(source, base_path=None):
    if source is None:
        return None
    if is_url(source):
        return source
    source_path = Path(source)
    if source_path.is_absolute():
        return str(source_path)
    root = Path(base_path) if base_path else PROJECT_ROOT
    return str(root / source_path)


def resolve_csv_source(source, base_path=None, mode=None):
    if source is None:
        return None
    filename = os.path.basename(str(source))
    if filename in KNOWN_CSV_FILES:
        return get_csv_source(filename, mode=mode, base_path=base_path)
    return resolve_source(source, base_path=base_path)


def read_named_csv(filename, mode=None, base_path=None, **read_csv_kwargs):
    preferred_source = get_csv_source(filename, mode=mode, base_path=base_path)
    fallback_source = (
        get_local_csv_path(filename, base_path=base_path)
        if is_url(preferred_source)
        else get_remote_csv_url(filename)
    )

    try:
        debug_log(f"Loading CSV '{filename}' from {preferred_source}")
        return _read_csv_with_source(preferred_source, **read_csv_kwargs), preferred_source
    except Exception as preferred_error:
        if fallback_source == preferred_source:
            raise
        try:
            error_log(f"CSV load failed from {preferred_source}. Trying fallback {fallback_source}")
            return _read_csv_with_source(fallback_source, **read_csv_kwargs), fallback_source
        except Exception as fallback_error:
            raise RuntimeError(
                f"Could not load '{filename}' from '{preferred_source}' nor '{fallback_source}'. "
                f"Errors: {preferred_error} | {fallback_error}"
            ) from fallback_error
