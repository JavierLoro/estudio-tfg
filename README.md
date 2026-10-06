# Estudio TFG

Entorno self-hosted para escribir la memoria del TFG (LaTeX + PDF lado a lado), consultar notas de Obsidian y capturar recursos sin perderlos.

Especificación: [docs/CONTRACT.md](docs/CONTRACT.md) · Worker y requisitos de la plantilla: [worker/README.md](worker/README.md)

## Arrancar (Mac)

```bash
cp .env.example .env        # ajustar NOTES_DIR y MEMORIA_DIR
npm run install:all
npm run worker              # TeX Live en Docker, 127.0.0.1:8090
npm run dev                 # API en 8787 y web en http://localhost:5173
```

Producción (Proxmox, más adelante): `docker compose --profile app up -d --build` → http://127.0.0.1:8787.

## Atajos

⌘K abrir/buscar · ⌘⇧C capturar · ⌘S guardar · ⌘↵ guardar y compilar · ⌥clic abrir al lado
