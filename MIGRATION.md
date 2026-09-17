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

## Fase 1 — Docker & infrastruttura

- [ ] Scrivere `docker-compose.yml` con servizi: `db` (postgis), `app` (Next.js), `worker` (RT ingest), `caddy`
- [ ] Scrivere `Dockerfile` per l'app (Next.js standalone)
- [ ] Scrivere `Dockerfile.worker` per il worker RT (Node)
- [ ] Script `scripts/migrate.sh` che applica le migrations in ordine con `psql`
- [ ] Adattare le migrations: rimuovere `pg_cron`, `pg_net`, Vault, policy RLS anon-facing

## Fase 2 — Staccare supabase-js

- [ ] Riscrivere `lib/supabase.ts` → `lib/db.ts` con wrapper `postgres.js`
- [ ] Aggiornare le 10 route in `app/api/` da `.rpc()`/`.from()` a query SQL dirette
- [ ] Rimuovere `@supabase/ssr` e `@supabase/supabase-js` da `package.json`
- [ ] Aggiornare variabili d'ambiente: via `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY`, resta solo `DATABASE_URL`

## Fase 3 — Worker realtime (Deno → Node)

- [ ] Portare `supabase/functions/ingest-rt/index.ts` → `worker/ingest-rt.ts` (Node)
- [ ] Entry point `worker/index.ts` con `setInterval(60_000)` + graceful shutdown
- [ ] Testare il ciclo RT localmente con `docker compose up`

## Fase 4 — Ingest statico

- [ ] Eliminare `.github/workflows/ingest-static.yml`
- [ ] Scrivere `deploy/atacwatch-ingest.timer` + `deploy/atacwatch-ingest.service` (systemd)
- [ ] Rimuovere `app/api/cron/ingest-static/route.ts` (non più necessario)
- [ ] Documentare il deploy del timer nel README

## Fase 5 — Deploy & CI

- [ ] Aggiornare GitHub Actions: build immagine → push GHCR → `ssh vps 'docker compose pull && up -d'`
- [ ] Scrivere `Caddyfile` con TLS automatico
- [ ] Scrivere `.env.example` con le sole variabili necessarie
- [ ] Aggiornare `README.md` con istruzioni VPS

---

## Variabili d'ambiente (post-migrazione)

```env
# .env (sul VPS, mai in repo)
DATABASE_URL=postgres://atacwatch:password@db:5432/atacwatch
NEXT_PUBLIC_MAPLIBRE_STYLE=...   # se presente
```

## Dimensionamento VPS consigliato

- 2 vCPU / 4 GB RAM / 20 GB SSD
- Il picco è durante `ingest:static` (rebuild delle tabelle GTFS da staging)
