# Attàccate — mezzi di Roma in tempo reale

Webapp mobile-first per il trasporto pubblico di Roma: ricerca linee, arrivi in
fermata (tempo reale + orario programmato), fermate vicine e mappa live dei mezzi.

Dati: **Roma Servizi per la Mobilità** (ATAC, Roma TPL) — GTFS + GTFS-Realtime,
licenza CC-BY-SA. Stack: **Next.js (Vercel) + Supabase (Postgres/PostGIS)**.

## Architettura

```
romamobilita.it (.pb + .zip)
   │
   ├── GTFS statico (zip)  ── Vercel Cron giornaliero ─┐
   │                          /api/cron/ingest-static  │ streaming + staging
   │                                                    ▼
   └── GTFS-RT (.pb)  ── Supabase Edge Function ──► Supabase Postgres (PostGIS)
        ogni 60s        ingest-rt (pg_cron)             │  rebuild_static_from_staging()
                                                        │
                                            RPC ◄───────┘
                                             │
                                   Next.js (App Router) — mobile-first, PWA
```

- L'ETL statico fa streaming dello zip, carica le tabelle `stg_*` a batch e
  delega l'aggregazione pesante (`stop_times` → `stop_schedule`, opzione C) a
  Postgres. Riutilizzabile come `pnpm ingest:static` (vedi sotto).
- I 3 feed real-time vengono decodificati ogni minuto dalla Edge Function.

## Setup

### 1. Dipendenze

```bash
pnpm install
cp .env.example .env.local   # poi compila i valori
```

### 2. Progetto Supabase

1. Crea un progetto su [supabase.com](https://supabase.com).
2. Database → Extensions: abilita **postgis**, **pg_cron**, **pg_net**.
3. SQL Editor: esegui in ordine i file in `supabase/migrations/`:
   `0001_schema.sql`, `0002_rebuild_static.sql`, `0003_rpc.sql`.
   (`0004_realtime_cron.sql` dopo aver fatto il deploy della Edge Function.)
4. Project Settings → API: copia `URL`, `anon key`, `service_role key` in `.env.local`.
5. Project Settings → Database: copia la connection string (URI) in `DATABASE_URL`.

### 3. Caricamento dati statici (orari, linee, fermate)

```bash
pnpm ingest:static
```

Scarica il GTFS, popola le staging e ricostruisce le tabelle. Verifica la
dimensione del DB (deve stare nel free tier ~500 MB):

```sql
select pg_size_pretty(pg_database_size(current_database()));
```

### 4. Ingestione real-time (Edge Function + cron)

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy ingest-rt
```

Poi, nel **Vault** di Supabase (Database → Vault), salva i due segreti:
`project_url` = `https://<PROJECT_REF>.supabase.co` e `service_role_key`.
Infine esegui `supabase/migrations/0004_realtime_cron.sql` per schedulare il
polling ogni minuto. Test manuale:

```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/ingest-rt \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

### 5. Mappa (opzionale ma consigliato)

Crea una chiave gratuita su [MapTiler](https://www.maptiler.com/) e mettila in
`NEXT_PUBLIC_MAPTILER_KEY`. Senza chiave si usa un raster OpenStreetMap di
ripiego (ok solo per sviluppo).

### 6. Sviluppo

```bash
pnpm dev   # http://localhost:3000
```

## Deploy su Vercel

1. Importa il repo su Vercel.
2. Imposta le stesse variabili di `.env.local` nelle Environment Variables.
3. Il cron giornaliero (`vercel.json`) chiama `/api/cron/ingest-static`
   (protetto da `CRON_SECRET`, iniettato automaticamente da Vercel).
   Se la funzione supera i limiti del piano Hobby, esegui l'ETL in locale con
   `pnpm ingest:static`.

## Struttura

| Percorso | Ruolo |
|----------|-------|
| `app/` | pagine (home, `/line/[id]`, `/stop/[id]`, `/trip/[tripId]`) e route API |
| `components/` | UI: ricerca, mappa (MapLibre), arrivi, fermate vicine |
| `lib/` | client Supabase, helper GTFS, ETL statico, stile mappa |
| `supabase/migrations/` | schema, aggregazione, RPC, cron |
| `supabase/functions/ingest-rt/` | Edge Function polling GTFS-RT |
| `scripts/ingest-static.ts` | entrypoint locale dell'ETL |

> **Nota — rotta `/map` deprecata.** La mappa live a tutto schermo (`/map`) è
> stata **deprecata e rimossa** dall'app: la visualizzazione dei mezzi su mappa
> resta disponibile nel dettaglio linea (`/line/[id]`) e corsa (`/trip/[tripId]`)
> tramite il componente `RouteMap` + endpoint `/api/vehicles`. L'infrastruttura
> lato API (`vehicles_in_bbox`, `/api/vehicles`) è mantenuta in caso si voglia
> reintrodurre la pagina in futuro.

## Licenze

Il codice è sotto **licenza MIT** ([LICENSE](LICENSE)).

Non tutto il contenuto è nostro, e il resto conserva la sua licenza:

- il carattere **Barlow** (e Barlow Semi Condensed) è sotto SIL Open Font
  License, servito da Google Fonts tramite `next/font`;
- i dati delle mappe sono © contributori **OpenStreetMap**, sotto ODbL;
- il motore di mappa è **MapLibre GL JS**, BSD a tre clausole;
- i dati di trasporto vengono dal feed pubblico di **ATAC / Roma Mobilità**.

L'app Android che consuma queste API sta in
[gorecodes/busroma-android](https://github.com/gorecodes/busroma-android), anche
lei sotto licenza MIT.
