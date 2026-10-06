# Worker de compilación LaTeX (Estudio TFG)
FROM node:24-slim AS node

FROM texlive/texlive:latest-full

# Node: solo el binario (el worker no tiene dependencias npm).
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# Usuario sin privilegios (uid 1000 ≈ usuario típico en Linux; en Docker Desktop da igual).
RUN (getent passwd 1000 >/dev/null && userdel -r "$(getent passwd 1000 | cut -d: -f1)" || true) \
 && (getent group 1000 >/dev/null || groupadd -g 1000 latex) \
 && useradd -u 1000 -g 1000 -M -d /tmp/home -s /usr/sbin/nologin latex \
 && mkdir -p /out && chown 1000:1000 /out \
 && node --version && latexmk -v | head -2

WORKDIR /app
COPY server.mjs parse-log.mjs untar.mjs ./

# Con raíz de solo lectura todo lo escribible vive en /tmp (tmpfs).
ENV NODE_ENV=production \
    PORT=8090 \
    OUT_DIR=/out \
    HOME=/tmp/home \
    TMPDIR=/tmp \
    TEXMFVAR=/tmp/texmf-var \
    TEXMFCONFIG=/tmp/texmf-config

USER 1000:1000
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8090/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/app/server.mjs"]
