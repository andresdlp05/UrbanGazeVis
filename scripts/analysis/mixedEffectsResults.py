import pandas as pd
import numpy as np
import statsmodels.formula.api as smf
from scipy import stats


def compute_attention_metrics(gaze_df):
    """
    Calcula proporciones de atención por trial.
    """
    attn_counts = (
        gaze_df.groupby(['participante', 'ImageName', 'main_class'])
        .size()
        .reset_index(name='fix_count')
    )

    total_fix = (
        gaze_df.groupby(['participante', 'ImageName'])
        .size()
        .reset_index(name='total_fix')
    )

    attn_metrics = attn_counts.merge(
        total_fix, on=['participante', 'ImageName']
    )

    attn_metrics['attn_prop'] = (
        attn_metrics['fix_count'] / attn_metrics['total_fix']
    )

    return attn_metrics


def pivot_attention(attn_metrics):
    """
    Pivot table de clases → columnas.
    """
    df_pivot = (
        attn_metrics.pivot_table(
            index=['participante', 'ImageName'],
            columns='main_class',
            values='attn_prop',
            fill_value=0
        )
        .reset_index()
    )

    return df_pivot


def standardize_predictors(df, clases_interes):
    """
    Estandariza predictores disponibles.
    """
    predictores_disponibles = []

    for clase in clases_interes:
        if clase in df.columns:
            col_std = f"{clase}_std"
            df[col_std] = stats.zscore(df[clase])
            predictores_disponibles.append(col_std)

    return df, predictores_disponibles


def run_mixed_model(df, predictores, include_group=True):
    """
    Ejecuta modelo de efectos mixtos.
    """
    if len(predictores) == 0:
        raise ValueError("No hay predictores disponibles.")

    cols_to_use = ['score', 'participante'] + predictores

    if include_group and 'grupo' in df.columns:
        cols_to_use.append('grupo')

    df_model = df[cols_to_use].dropna().reset_index(drop=True)

    formula = "score ~ " + " + ".join(predictores)

    if include_group and 'grupo' in df_model.columns:
        formula += " + C(grupo)"

    model = smf.mixedlm(
        formula,
        data=df_model,
        groups=df_model["participante"]
    )

    result = model.fit()

    return result, df_model


def full_pipeline(gaze_path, scores_path, clases_interes):
    """
    Pipeline completo listo para paper.
    """
    gaze_df = pd.read_csv(gaze_path)
    scores_df = pd.read_csv(scores_path)

    attn_metrics = compute_attention_metrics(gaze_df)
    df_pivot = pivot_attention(attn_metrics)

    df_final = scores_df.merge(
        df_pivot,
        on=['participante', 'ImageName'],
        how='inner'
    )

    df_final, predictores = standardize_predictors(
        df_final, clases_interes
    )

    result, df_model = run_mixed_model(df_final, predictores)

    return result, df_final, df_model, predictores
