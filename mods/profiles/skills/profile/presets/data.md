# Preset: data

**Signals:** notebooks (`*.ipynb`), `pyproject.toml` with numpy, pandas, scipy, torch or scikit-learn; `*.m` MATLAB files; `data/` with CSV or Parquet.

**Relevant skills:** scientific computing, statistics, data visualization, ML engineering, control and DSP, biosignals, SQL.

**Commands to look for:** `uv run pytest`, `ruff check`, a training or analysis entry point, `matlab -batch`.

**Permissions:** allow tests, lint and short analysis scripts; ask before long training runs, downloads of datasets or model weights, and anything that writes into `data/`.

**Extras:** keep raw data read-only; record seeds and versions with results.
