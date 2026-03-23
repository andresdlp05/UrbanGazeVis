from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
import pandas as pd


def prepare_dataframe(result, p_threshold=None):

    df = pd.DataFrame({
        "Predictor": result.params.index,
        "Coef (β)": result.params.values,
        "S.E.": result.bse.values,
        "z-val": result.tvalues.values,
        "p-val": result.pvalues.values
    })

    ci = result.conf_int()
    df["CI_low"] = ci[0].values
    df["CI_high"] = ci[1].values

    if p_threshold is not None:
        df = df[df["p-val"] < p_threshold]

    # ---------- FORMATOS BONITOS ----------
    def fmt(x, pattern):
        if pd.isna(x):
            return "-"
        return format(x, pattern)

    df["Coef (β)_fmt"] = df["Coef (β)"].map(lambda x: fmt(x, ".6g"))
    df["S.E._fmt"] = df["S.E."].map(lambda x: fmt(x, ".6g"))
    df["z-val_fmt"] = df["z-val"].map(lambda x: fmt(x, ".6g"))
    df["p-val_fmt"] = df["p-val"].map(lambda x: fmt(x, ".3e"))

    df["95% CI"] = df.apply(
        lambda r: "-"
        if pd.isna(r["CI_low"]) else f"[{fmt(r['CI_low'], '.3g')}, {fmt(r['CI_high'], '.3g')}]",
        axis=1
    )

    return df


# ---------------------------------------------------------

def generate_normal_table(df, filename):

    cols_display = [
        "Predictor",
        "Coef (β)_fmt",
        "S.E._fmt",
        "z-val_fmt",
        "p-val_fmt",
        "95% CI"
    ]

    headers = ["Predictor", "Coef (β)", "S.E.", "z-val", "p-val", "95% CI"]

    table_data = [headers] + df[cols_display].values.tolist()

    doc = SimpleDocTemplate(filename, pagesize=letter)
    styles = getSampleStyleSheet()

    elements = []
    elements.append(Paragraph("<b>Mixed Effects Model Results</b>", styles['Title']))
    elements.append(Spacer(1, 12))

    t = Table(table_data)

    t.setStyle(TableStyle([
        ('FONT', (0,0), (-1,0), 'Helvetica-Bold'),
        ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),

        ('FONT', (0,1), (-1,-1), 'Helvetica'),

        ('ALIGN', (1,1), (-1,-1), 'CENTER'),
        ('ALIGN', (0,0), (0,-1), 'LEFT'),

        ('LINEBELOW', (0,0), (-1,0), 1.5, colors.black),

        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
    ]))

    elements.append(t)
    doc.build(elements)



# ---------------------------------------------------------

def generate_filtered_table(df, filename):

    cols_display = [
        "Predictor",
        "Coef (β)_fmt",
        "S.E._fmt",
        "z-val_fmt",
        "p-val_fmt",
        "95% CI"
    ]

    headers = ["Predictor", "Coef (β)", "S.E.", "z-val", "p-val", "95% CI"]

    intercept = df[df["Predictor"].str.contains("Intercept", case=False)]
    df_vars = df[~df["Predictor"].str.contains("Intercept", case=False)]

    df_pos = df_vars[df_vars["Coef (β)"] > 0].sort_values(by="Coef (β)", ascending=False)
    df_neg = df_vars[df_vars["Coef (β)"] < 0].sort_values(by="Coef (β)", ascending=True)

    table_data = []
    table_data.append(headers)

    if len(intercept) > 0:
        table_data += intercept[cols_display].values.tolist()

    if len(df_pos) > 0:
        table_data.append(["Positive (SAFE)", "", "", "", "", ""])
        table_data += df_pos[cols_display].values.tolist()

    if len(df_neg) > 0:
        table_data.append(["Negative (UNSAFE)", "", "", "", "", ""])
        table_data += df_neg[cols_display].values.tolist()

    doc = SimpleDocTemplate(filename, pagesize=letter)
    styles = getSampleStyleSheet()

    elements = []
    elements.append(Paragraph("<b>Mixed Effects Model Results (Significant)</b>", styles['Title']))
    elements.append(Spacer(1, 12))

    t = Table(table_data)

    t.setStyle(TableStyle([
        ('FONT', (0,0), (-1,0), 'Helvetica-Bold'),
        ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),

        ('FONT', (0,1), (-1,-1), 'Helvetica'),

        ('ALIGN', (1,1), (-1,-1), 'CENTER'),
        ('ALIGN', (0,0), (0,-1), 'LEFT'),

        ('LINEBELOW', (0,0), (-1,0), 1.5, colors.black),

        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
    ]))

    for i, row in enumerate(table_data):
        if "Positive" in str(row[0]) or "Negative" in str(row[0]):
            t.setStyle(TableStyle([
                ('FONT', (0,i), (-1,i), 'Helvetica-Bold'),
                ('SPAN', (0,i), (-1,i)),
                ('TOPPADDING', (0,i), (-1,i), 10),
                ('BOTTOMPADDING', (0,i), (-1,i), 4),
            ]))

    elements.append(t)
    doc.build(elements)



# ---------------------------------------------------------

def generate_tables(result, mode="both", p_threshold=0.01):

    if mode not in ["normal", "filter", "both"]:
        raise ValueError("mode debe ser: normal | filter | both")

    if mode in ["normal", "both"]:
        df_normal = prepare_dataframe(result)
        generate_normal_table(df_normal, "Mixed_Model_Table_NORMAL.pdf")

    if mode in ["filter", "both"]:
        df_filtered = prepare_dataframe(result, p_threshold)
        generate_filtered_table(df_filtered, "Mixed_Model_Table_FILTER.pdf")

    print("PDFs generados correctamente")

