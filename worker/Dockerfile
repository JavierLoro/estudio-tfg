# syntax=docker/dockerfile:1.7
# Worker de compilación LaTeX (Estudio TFG)
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS node

# TeX Live 2026; índice para linux/amd64 y linux/arm64, ver README (R8).
FROM texlive/texlive@sha256:a7ae4dfa9d521b5db14446872fa488b839021d1f604d0a3c74461784895f2a67

# Node: solo el binario (el worker no tiene dependencias npm).
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# Diagramas (v0.8): rsvg-convert para SVG → PDF y la fuente de los diagramas.
# La fuente es la MISMA que usa la web para medir el texto (@fontsource/source-sans-3,
# misma versión que web/package.json; OFL-1.1): se descarga el paquete npm con su hash y
# sus .woff se pasan a .ttf con woff2sfnt.mjs (mismas tablas: mismos glifos y métricas;
# Pango/HarfBuzz no abren .woff) en /usr/local/share/fonts/source-sans-3.
# TeX Live trae otra versión de Source Sans 3: fontconfig-diagramas.conf la descarta.
ARG FONT_PKG_VERSION=5.3.0
ADD --checksum=sha256:f8a0e1b603f5c85a468946a51af4a761d726c28baf79200aafb8736fe9e7d7a7 \
    https://registry.npmjs.org/@fontsource/source-sans-3/-/source-sans-3-${FONT_PKG_VERSION}.tgz /tmp/source-sans-3.tgz
COPY woff2sfnt.mjs /tmp/woff2sfnt.mjs
RUN apt-get update \
 && apt-get install -y --no-install-recommends librsvg2-bin fontconfig \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /usr/local/share/fonts/source-sans-3 \
 && tar -xzf /tmp/source-sans-3.tgz -C /tmp package/LICENSE \
      package/files/source-sans-3-latin-400-normal.woff package/files/source-sans-3-latin-400-italic.woff \
      package/files/source-sans-3-latin-700-normal.woff package/files/source-sans-3-latin-700-italic.woff \
      package/files/source-sans-3-latin-ext-400-normal.woff package/files/source-sans-3-latin-ext-700-normal.woff \
 && for f in /tmp/package/files/*.woff; do \
      node /tmp/woff2sfnt.mjs "$f" "/usr/local/share/fonts/source-sans-3/$(basename "$f" .woff).ttf" || exit 1; \
    done \
 && mv /tmp/package/LICENSE /usr/local/share/fonts/source-sans-3/ \
 && rm -rf /tmp/package /tmp/source-sans-3.tgz /tmp/woff2sfnt.mjs \
 && rsvg-convert --version

COPY fontconfig-diagramas.conf /etc/fonts/conf.d/99-estudio-tfg-diagramas.conf
RUN fc-cache -f \
 && test "$(fc-list 'Source Sans 3' file | grep -vc /usr/local/share/fonts/)" = 0 \
 && fc-match -f '%{file}\n' 'Source Sans 3' | grep -q /usr/local/share/fonts/source-sans-3/

# Usuario sin privilegios (uid 1000 ≈ usuario típico en Linux; en Docker Desktop da igual).
RUN (getent passwd 1000 >/dev/null && userdel -r "$(getent passwd 1000 | cut -d: -f1)" || true) \
 && (getent group 1000 >/dev/null || groupadd -g 1000 latex) \
 && useradd -u 1000 -g 1000 -M -d /tmp/home -s /usr/sbin/nologin latex \
 && mkdir -p /out && chown 1000:1000 /out \
 && node --version && latexmk -v | head -2

WORKDIR /app
COPY server.mjs parse-log.mjs untar.mjs svg.mjs ./
RUN { printf 'Distribución: ' && kpsewhich -var-value=TEXMFROOT \
      && pdflatex --version && latexmk -norc -v && biber --noconf --version \
      && printf 'Node: ' && node --version && rsvg-convert --version; \
    } > /app/toolchain.txt \
 && cat /app/toolchain.txt

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
