# Estudio TFG

Entorno self-hosted para escribir la memoria del TFG (LaTeX + PDF lado a lado), consultar notas de Obsidian y capturar recursos sin perderlos.

Especificación: [docs/CONTRACT.md](docs/CONTRACT.md) · Worker y requisitos de la plantilla: [worker/README.md](worker/README.md)

## Arrancar (Mac)

```bash
npm run init                # crea .env y tu memoria desde la plantilla (fuera de git)
npm run install:all
npm run worker              # TeX Live en Docker, 127.0.0.1:8090
npm run dev                 # API en 8787 y web en http://localhost:5173
```

Producción (Proxmox, más adelante): `docker compose --profile app up -d --build` → http://127.0.0.1:8787.

## Qué va al repo y qué no

Este repositorio es **solo la herramienta**: código, la plantilla base (`templates/esi-tfg/`) y datos de prueba ficticios. Tu trabajo nunca entra aquí:

| Contenido | Dónde vive | Versionado |
| --- | --- | --- |
| Memoria del TFG | `MEMORIA_DIR` (p. ej. `~/Documents/tfg-memoria`) | Su propio git, independiente |
| Notas y recursos | `NOTES_DIR` (tu vault de Obsidian) | El del vault |
| Compilaciones e historial | `data/` | Ignorado |
| Configuración local | `.env` | Ignorado |

- `npm run init` copia `templates/esi-tfg/` a `MEMORIA_DIR` solo si está vacío y le crea su propio git. Nunca sobrescribe.
- El servidor **se niega a arrancar** si `NOTES_DIR` o `MEMORIA_DIR` apuntan a una carpeta versionada del repo; dentro del repo solo se permite `workspace/`, que está ignorada.
- Las mejoras a la plantilla base se hacen en `templates/esi-tfg/`; no se propagan solas a una memoria ya creada.

## Atajos

⌘K abrir/buscar · ⌘⇧C capturar · ⌘S guardar · ⌘↵ guardar y compilar · ⌘⇧J ver en el PDF · ⌘clic en el PDF ir al código · ⌥clic abrir al lado

## Licencia

Estudio TFG se distribuye bajo la [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Puedes usarlo, estudiarlo y modificarlo; si distribuyes una versión modificada o la ofreces como servicio en red, debes publicar su código bajo la misma licencia.

La plantilla de `templates/esi-tfg/` deriva de la clase [esi-tfg](https://github.com/UCLM-ESI/esi-tfg) del grupo ARCO (UCLM-ESI), distribuida bajo GPL-2.0 o posterior; se mantiene su aviso de copyright y licencia en la clase. El logotipo de la ESI pertenece a la Universidad de Castilla-La Mancha.
