# AtacWatch — Guida operativa VPS

Documento consolidato delle decisioni architetturali e istruzioni di deploy.
Branch: `migrate/vps`

---

## 1. Perché VPS e non un rewrite

Il problema era la **piattaforma** (Vercel + Supabase), non le tecnologie. Le scelte
tecniche sono rimaste identiche:

| Componente | Prima | Dopo |
|---|---|---|
| Frontend + API | Next.js su Vercel | Next.js standalone in container |
| Database | Supabase (PostgreSQL hosted) | `postgis/postgis:17-3.5` in container |
| Query | `supabase-js` → PostgREST | `postgres.js` diretto (già dipendenza) |
| RT ingest (60s) | Deno Edge Function + pg_cron | worker Node (`setInterval`) |
| ETL statico | GitHub Actions | systemd timer sul VPS |
| TLS | Vercel automatico | Cloudflare proxy (nuvola arancione) |
| Reverse proxy | - | Caddy su porta 80 |

Un rewrite avrebbe richiesto settimane per arrivare allo stesso punto funzionale,
con rischio di perdere edge case già risolti (corse oltre mezzanotte, lock
anti-sovrapposizione RT, ottimizzazioni RPC). Il codice SQL nelle migrations
è il pezzo più prezioso e si porta com'è.

---

## 2. Architettura post-migrazione

```
Internet
   │
   ▼
Cloudflare (TLS, CDN, proxy)
   │ HTTP :80
   ▼
Caddy (reverse proxy, rete Docker interna)
   │
   ├──► app:3000  (Next.js standalone)
   │        │
   │        └──► db:5432 (PostgreSQL + PostGIS)
   │
   └──► worker   (Node, RT ingest ogni 60s)
            │
            └──► db:5432
```

Il DB **non è mai esposto** sulla rete host: accessibile solo nella rete Docker interna.

---

## 3. File creati nella Fase 1

| File | Scopo |
|---|---|
| `docker-compose.yml` | 4 servizi: `db`, `app`, `worker`, `caddy` + servizio `migrate` (profile tools) |
| `docker-compose.override.yml` | Override locale: espone app su :3000, disabilita caddy |
| `Dockerfile` | Build Next.js standalone (multi-stage, 3 layer) |
| `Dockerfile.worker` | Worker Node RT (completato in Fase 3) |
| `deploy/Caddyfile` | Reverse proxy su :80, no ACME (TLS delegato a Cloudflare) |
| `deploy/atacwatch-ingest.service` | Systemd service per ETL GTFS statico |
| `deploy/atacwatch-ingest.timer` | Systemd timer: esegue alle 4:00, `Persistent=true` |
| `scripts/migrate.sh` | Applica tutte le migrations in ordine con `psql` |
| `.env.example` | Template variabili d'ambiente |
| `next.config.ts` | Aggiunto `output: "standalone"` |
| `supabase/migrations/0004_realtime_cron.sql` | Sostituita con no-op (rimuove pg_cron/pg_net/Vault) |

---

## 4. Configurazione

### 4.1 File `.env` (unica cosa da creare)

```bash
cp .env.example .env
```

```env
# Unica variabile richiesta in locale e sul VPS
DB_PASSWORD=<stringa_casuale>    # openssl rand -base64 32
```

Il `DATABASE_URL` è costruito automaticamente dal compose:
`postgres://atacwatch:${DB_PASSWORD}@db:5432/atacwatch`

Il `DOMAIN` **non serve**: il routing DNS e il TLS sono gestiti da Cloudflare.

### 4.2 Systemd (solo VPS)

Nel file `deploy/atacwatch-ingest.service`, cambia `WorkingDirectory` con il
percorso effettivo del repo sul VPS:

```ini
WorkingDirectory=/home/tuo_utente/AtacWatch   # ← modifica questo
```

---

## 5. Test in locale

```bash
# 1. Crea il .env
cp .env.example .env
# imposta DB_PASSWORD nel .env

# 2. Avvia i container (override caricato automaticamente, caddy disabilitato)
docker compose up -d db          # prima solo il db
docker compose run --rm migrate  # applica le migrations
docker compose up -d             # avvia tutto

# 3. Accedi
# http://localhost:3000
# oppure http://<IP-LAN>:3000 da altri dispositivi in rete
```

> `docker-compose.override.yml` viene caricato automaticamente da `docker compose`
> quando si trova nella stessa directory. Espone l'app su `:3000` e disabilita Caddy.

---

## 6. Deploy su VPS (Fase 6)

### Prima installazione

```bash
# Sul VPS
git clone <repo> /opt/atacwatch
cd /opt/atacwatch
cp .env.example .env
# imposta DB_PASSWORD nel .env
# NON portare docker-compose.override.yml

# Avvia DB, applica migrations, avvia tutto
docker compose up -d db
docker compose run --rm migrate
docker compose up -d
```

### Systemd timer (ETL statico)

```bash
sudo cp deploy/atacwatch-ingest.service /etc/systemd/system/
sudo cp deploy/atacwatch-ingest.timer   /etc/systemd/system/
# Modifica WorkingDirectory nel .service con il percorso reale
sudo systemctl daemon-reload
sudo systemctl enable --now atacwatch-ingest.timer
```

### Aggiornamenti successivi (manuali, prima dell'automazione CI)

```bash
cd /opt/atacwatch
git pull
docker compose up -d --build
```

### Automazione via CI (dopo Fase 5)

L'Action di Fase 5 aggiungerà uno step SSH che esegue automaticamente
`docker compose pull && docker compose up -d` ad ogni push su `main`.

---

## 7. Cloudflare

### Impostazioni richieste

| Sezione | Impostazione | Valore |
|---|---|---|
| DNS | Record A per il dominio | IP del VPS, **nuvola arancione** (proxy attivo) |
| SSL/TLS → Overview | Modalità cifratura | **Full** (non Flexible, non Full Strict) |

**Perché Full e non Full Strict?**
Caddy serve HTTP puro, senza certificato firmato da CA pubblica. La modalità
"Full" cifra il tratto Cloudflare→VPS accettando anche certificati self-signed.
"Full Strict" richiederebbe un certificato valido sul server.

### Firewall VPS (consigliato)

Apri solo la porta 80 e consenti connessioni solo dai range IP di Cloudflare:
- IPv4: https://www.cloudflare.com/ips-v4
- IPv6: https://www.cloudflare.com/ips-v6

Questo impedisce di raggiungere il server bypassando Cloudflare.

### Porte sul VPS

| Porta | Esposta | Motivo |
|---|---|---|
| 80 | Sì | Cloudflare → Caddy |
| 443 | No | TLS terminato da Cloudflare |
| 5432 | No | DB solo rete Docker interna |

---

## 8. ETL statico (systemd timer)

Sostituisce la GitHub Action `ingest-static.yml`.

### Installazione sul VPS (una tantum)

```bash
# Copia i file di servizio
sudo cp deploy/atacwatch-ingest.service /etc/systemd/system/
sudo cp deploy/atacwatch-ingest.timer   /etc/systemd/system/

# Modifica il WorkingDirectory nel .service se necessario
sudo systemctl daemon-reload

# Abilita e avvia il timer
sudo systemctl enable --now atacwatch-ingest.timer

# Verifica
sudo systemctl list-timers atacwatch-ingest.timer
sudo journalctl -u atacwatch-ingest.service -f
```

### Esecuzione manuale

```bash
cd /opt/atacwatch
docker compose run --rm worker pnpm ingest:static
```

---

## 9. Comandi utili

```bash
# Avvio/stop
docker compose up -d
docker compose down

# Logs
docker compose logs -f app
docker compose logs -f worker

# Applica migrations (idempotente)
docker compose run --rm migrate

# ETL statico manuale
docker compose run --rm worker pnpm ingest:static

# Shell nel DB
docker compose exec db psql -U atacwatch -d atacwatch

# Backup DB
docker compose exec db pg_dump -U atacwatch atacwatch > backup_$(date +%Y%m%d).sql

# Rebuild solo l'app (dopo un git pull)
docker compose up -d --build app
```

---

## 10. Fasi della migrazione

- [x] **Fase 1** — Docker, Caddy, systemd, migrate.sh
- [x] **Fase 2** — Staccare supabase-js → postgres.js diretto
- [x] **Fase 3** — Worker RT (Deno → Node)
- [x] **Fase 4** — Rimozione GitHub Action e route cron
- [ ] **Fase 5** — CI/CD: build immagine → push GHCR
- [ ] **Fase 6** — Deploy su VPS via SSH + automazione CI
