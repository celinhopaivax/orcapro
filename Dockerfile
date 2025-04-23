FROM python:3.11-slim-bookworm

ENV PYTHON_BUILD_SKIP_MISE=1 \
    FLASK_APP=app.py \
    PORT=8080

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "app:app"]
