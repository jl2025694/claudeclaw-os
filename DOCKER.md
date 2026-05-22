# ClaudeClaw OS en Docker

Esta configuracion ejecuta ClaudeClaw OS como un contenedor portable. La imagen
contiene Node 22, Chromium, ffmpeg, Python, Git y Claude Code CLI.

## Archivos

- `Dockerfile`: construye la imagen.
- `docker-compose.yml`: arranca el servicio `claudeclaw-os`.
- `.dockerignore`: evita copiar secretos, base de datos, logs y caches dentro de la imagen.

## Datos persistentes

El contenedor monta estos datos desde el host:

- `.env` -> `/app/.env`
- `store/` -> `/app/store`
- `workspace/` -> `/app/workspace`
- `logs/` -> `/app/logs`
- `.wwebjs_cache/` -> `/app/.wwebjs_cache`
- `~/.claudeclaw` -> `/data/claudeclaw`
- `~/.claude` -> `/root/.claude`

Para migrar a otra maquina, copia:

```bash
/Users/hernan/Git/claudeclaw-os/.env
/Users/hernan/Git/claudeclaw-os/store
/Users/hernan/Git/claudeclaw-os/workspace
/Users/hernan/Git/claudeclaw-os/logs
/Users/hernan/Git/claudeclaw-os/.wwebjs_cache
/Users/hernan/.claudeclaw
/Users/hernan/.claude
```

## Construir

```bash
cd /Users/hernan/Git/claudeclaw-os
docker compose build claudeclaw
```

## Arrancar

Importante: no corras a la vez el servicio `launchd` y el contenedor con el
mismo bot de Telegram. Telegram solo debe tener un proceso haciendo polling.

Para parar el servicio macOS actual:

```bash
launchctl bootout gui/$(id -u) /Users/hernan/Library/LaunchAgents/com.claudeclaw.app.plist
```

Luego arranca Docker:

```bash
docker compose up -d claudeclaw
```

Dashboard:

```text
http://127.0.0.1:3141
```

Logs:

```bash
docker compose logs -f claudeclaw
```

## Volver a launchd

```bash
docker compose down
launchctl bootstrap gui/$(id -u) /Users/hernan/Library/LaunchAgents/com.claudeclaw.app.plist
launchctl kickstart -k gui/$(id -u)/com.claudeclaw.app
```

## Exponer por LAN o VPN

Por defecto el compose publica el dashboard solo en `127.0.0.1:3141`.

Para LAN/VPN, cambia en `docker-compose.yml`:

```yaml
ports:
  - "3141:3141"
```

Mantiene `DASHBOARD_BIND=0.0.0.0` dentro del contenedor.
