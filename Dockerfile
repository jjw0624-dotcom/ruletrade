FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RULETRADE_DATA_DIR=/app/data

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
COPY data ./data
COPY examples ./examples
COPY tests ./tests
COPY scripts ./scripts

RUN pip install --no-cache-dir -e ".[bt,dev]"

EXPOSE 8000
CMD ["uvicorn", "ruletrade.api:app", "--host", "0.0.0.0", "--port", "8000"]
