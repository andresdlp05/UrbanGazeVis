# app/shared/ivt_cache_service.py

import os, json, math
import pandas as pd
from app.shared.logging_utils import debug_log, error_log

class IVTCacheService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        self.gaze_data           = self._load_gaze_data()
        self.ivt_cache           = self._load_ivt_cache()
        self.hololens_data       = self._load_hololens_data()
        self.gaze_data_by_image  = self._build_cache_by_image(self.gaze_data)
        self.ivt_cache_by_image  = self._build_cache_by_image(self.ivt_cache)
        self.gaze_min_time_cache = self._build_min_time_cache(self.gaze_data, 'Time')
        self.ivt_min_time_cache  = self._build_min_time_cache(self.ivt_cache, 'start')
        self.participant_scores  = self._build_participant_scores(self.hololens_data)
        self.imagename_to_index  = self._build_imagename_index()

    def _load_gaze_data(self):
        try:
            base = os.path.dirname(os.path.abspath(__file__))
            data_path = os.path.join(base, '..', '..', 'static', 'data', 'csv', 'df_final1.csv')
            df = pd.read_csv(data_path)
            debug_log(f"IVTCacheService: gaze data loaded ({len(df)} rows)")
            return df
        except Exception as e:
            error_log(f"IVTCacheService: error loading gaze data: {e}")
            return None

    def _load_ivt_cache(self):
        try:
            base = os.path.dirname(os.path.abspath(__file__))
            data_path = os.path.join(base, '..', '..', 'static', 'data', 'csv', 'ivt_precalculated.csv')
            if os.path.exists(data_path):
                df = pd.read_csv(data_path)
                debug_log(f"IVTCacheService: IVT cache loaded ({len(df)} rows)")
                return df
            else:
                error_log(f"IVTCacheService: IVT cache file not found at {data_path}")
                return None
        except Exception as e:
            error_log(f"IVTCacheService: error loading IVT cache: {e}")
            return None

    def _load_hololens_data(self):
        try:
            base = os.path.dirname(os.path.abspath(__file__))
            data_path = os.path.join(base, '..', '..', 'static', 'data', 'json', 'data_hololens.json')
            if os.path.exists(data_path):
                with open(data_path, 'r') as f:
                    data = json.loads(f.read())
                debug_log(f"IVTCacheService: hololens data loaded ({len(data)} images)")
                return data
            error_log(f"IVTCacheService: hololens data file not found at {data_path}")
            return {}
        except Exception as e:
            error_log(f"IVTCacheService: error loading hololens data: {e}")
            return {}

    def _build_cache_by_image(self, df, image_column='ImageName'):
        cache = {}
        if df is None or image_column not in df.columns:
            return cache
        try:
            grouped = df.groupby(image_column, sort=False)
            for image_id, group in grouped:
                try:
                    key = int(image_id)
                except (TypeError, ValueError):
                    continue
                cache[key] = group
        except Exception as e:
            error_log(f"IVTCacheService: warning building cache by image: {e}")
        return cache

    def _build_min_time_cache(self, df, time_column):
        cache = {}
        required_cols = {'ImageName', 'participante', time_column}
        if df is None or not required_cols.issubset(df.columns):
            return cache
        try:
            min_series = (
                df.dropna(subset=['ImageName', 'participante', time_column])
                  .groupby(['ImageName', 'participante'])[time_column]
                  .min()
            )
            for (image_id, participant_id), min_time in min_series.items():
                try:
                    image_key = int(image_id)
                    participant_key = int(participant_id)
                    min_time_val = float(min_time)
                except (TypeError, ValueError):
                    continue
                image_cache = cache.setdefault(image_key, {})
                image_cache[participant_key] = min_time_val
        except Exception as e:
            error_log(f"IVTCacheService: warning building min time cache ({time_column}): {e}")
        return cache

    def _build_participant_scores(self, full_data):
        cache = {}
        if not full_data:
            return cache
        for image_id_str, image_data in full_data.items():
            try:
                image_id = int(image_id_str)
            except (TypeError, ValueError):
                continue
            per_participant = {}
            for score_info in image_data.get('score_participant', []):
                participant = score_info.get('participant')
                if participant is None:
                    continue
                try:
                    participant_id = int(participant)
                except (TypeError, ValueError):
                    continue
                per_participant[participant_id] = {
                    'score':  score_info.get('score'),
                    'age':    score_info.get('age'),
                    'gender': score_info.get('gender'),
                    'state':  score_info.get('state')
                }
            cache[image_id] = per_participant
        return cache

    def _build_imagename_index(self):
        if self.gaze_data is None:
            return {}
        mapping = (
            self.gaze_data[['ImageName', 'ImageIndex']]
            .drop_duplicates()
            .set_index('ImageName')['ImageIndex']
            .to_dict()
        )
        return mapping

    def get_combined_min_times(self, image_id, participant_id=None):
        combined = {}
        for src in (self.gaze_min_time_cache.get(image_id, {}),
                    self.ivt_min_time_cache.get(image_id, {})):
            for pid, min_time in src.items():
                if participant_id is not None and int(pid) != int(participant_id):
                    continue
                if pid not in combined:
                    combined[pid] = float(min_time)
                else:
                    combined[pid] = min(combined[pid], float(min_time))
        return combined

    def get_image_index_from_name(self, image_name):
        if image_name in self.imagename_to_index:
            return self.imagename_to_index[image_name]
        if self.gaze_data is not None:
            result = self.gaze_data[self.gaze_data['ImageName'] == image_name]['ImageIndex']
            if len(result) > 0:
                return int(result.iloc[0])
        return None


def get_ivt_cache_service():
    return IVTCacheService()


