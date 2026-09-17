# Piano di migrazione: Vercel + Supabase → VPS

Branch: `migrate/vps`

## Contesto

Il progetto AtacWatch nasce su Vercel (frontend + API) + Supabase (PostgreSQL hosted) + GitHub Actions (ETL statico). L'obiettivo è portarlo su un VPS self-hosted con Docker, eliminando le dipendenze da piattaforme managed.

**Scelte architetturali:**
- DB: container `postgis/postgis` (stesso Postgres + PostGIS + pg_trgm, zero cambi SQL)
- App: Next.js standalone in container, dietro Caddy (TLS automatico)
- RT ingest: worker Node long-running (`setInterval 60s`) invece di Deno Edge Function + pg_cron
- ETL statico: systemd timer giornaliero sul VPS (opzione A) invece di GitHub Actions
- Accesso DB: `postgres.js` diretto (già dipendenza) invece di supabase-js → PostgREST

---

## Fase 1 — Docker & infrastruttura ✅

- [x] Scrivere `docker-compose.yml` con servizi: `db` (postgis), `app` (Next.js), `worker` (RT ingest), `caddy`
- [x] Scrivere `Dockerfile` per l'app (Next.js standalone)
- [x] Scrivere `Dockerfile.worker` per il worker RT (Node)
- [x] Script `scripts/migrate.sh` che applica le migrations in ordine con `psql`
- [x] Adattare le migrations: `0004_realtime_cron.sql` sostituita con no-op (rimossi pg_cron, pg_net, Vault)
- [x] `deploy/Caddyfile` — reverse proxy con TLS automatico
- [x] `deploy/atacwatch-ingest.{service,timer}` — systemd timer (sostituzione GitHub Action)
- [x] `.env.example` — solo `DB_PASSWORD` + `DOMAIN`
- [x] `next.config.ts` — abilitato `output: "standalone"`

## Fase 2 — Staccare supabase-js

- [ ] Riscrivere `lib/supabase.ts` → `lib/db.ts` con wrapper `postgres.js`
- [ ] Aggiornare le 10 route in `app/api/` da `.rpc()`/`.from()` a query SQL dirette
- [ ] Rimuovere `@supabase/ssr` e `@supabase/supabase-js` da `package.json`
- [ ] Rimuovere variabili `NEXT_PUBLIC_SUPABASE_*` e `SUPABASE_SERVICE_ROLE_KEY`; resta solo `DATABASE_URL`

## Fase 3 — Worker realtime (Deno → Node)

- [ ] Portare `supabase/functions/ingest-rt/index.ts` → `worker/ingest-rt.ts` (Node)
- [ ] Entry point `worker/index.ts` con `setInterval(60_000)` + graceful shutdown
- [ ] Testare il ciclo RT localmente con `docker compose up`

## Fase 4 — Ingest statico

- [ ] Eliminare `.github/workflows/ingest-static.yml`
- [ ] Rimuovere `app/api/cron/ingest-static/route.ts` (non più necessario)
- [ ] Documentare il deploy del timer nel README

## Fase 5 — Deploy & CI

- [ ] Aggiornare GitHub Actions: build immagine → push GHCR → `ssh vps 'docker compose pull && up -d'`
- [ ] Aggiornare `README.md` con istruzioni VPS

---

## Variabili d'ambiente (post-migrazione)

```env
# .env (sul VPS, mai in repo)
DB_PASSWORD=<stringa_casuale>          # generata con: openssl rand -base64 32
DOMAIN=atacwatch.example.com
```

Il `DATABASE_URL` è costruito internamente dal `docker-compose.yml`:
`postgres://atacwatch:${DB_PASSWORD}@db:5432/atacwatch`

## Dimensionamento VPS consigliato

- 2 vCPU / 4 GB RAM / 20 GB SSD
- Il picco è durante `ingest:static` (rebuild delle tabelle GTFS da staging)
