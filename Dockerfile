# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    TUNNEL_MODE=true \
    COOKIE_SECURE=true \
    SCAN_CONCURRENCY=1

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
# Optional CA mount supports builds behind a trusted enterprise proxy without
# embedding that environment's certificate or proxy credentials in the image.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      export PIP_CERT=/run/secrets/proxy_ca SSL_CERT_FILE=/run/secrets/proxy_ca \
        NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; \
    fi; \
    python -m pip install --no-cache-dir -r backend/requirements.txt && \
    python -m playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/* && \
    chmod -R a+rX /opt/playwright

RUN groupadd --gid 10001 accesspilot && \
    useradd --uid 10001 --gid accesspilot --create-home accesspilot
COPY --chown=root:root backend/ /app/backend/
USER accesspilot
EXPOSE 8000
CMD ["python", "-m", "backend.serve"]
