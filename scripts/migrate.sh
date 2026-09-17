#!/usr/bin/env bash
# Applica le migration non ancora applicate sul database indicato da DATABASE_URL.
#
# Uso diretto (richiede psql installato localmente):
#   DATABASE_URL=postgres://... ./scripts/migrate.sh
#
# Uso consigliato via Docker (niente psql richiesto):
#   docker compose run --rm migrate
#
# Le migration NON sono idempotenti: la 0003 definisce route_stops_geo, che una
# migration successiva ridefinisce con un tipo di ritorno diverso, e
# "create or replace function" non può cambiare il tipo di ritorno. Riapplicare
# tutto su un DB già migrato fallisce. Per questo teniamo traccia in
# schema_migrations di cosa è già passato, e applichiamo solo il resto.
set -euo pipefail

DB_URL="${DATABASE_URL:?DATABASE_URL è richiesta (es: postgres://user:pass@host:5432/db)}"

# Ultima migration dell'era pre-tracking. Un DB che ha già lo schema ma non la
# tabella di tracking è stato migrato a mano fino a qui: le segniamo come
# applicate invece di ritentarle (ritentarle fallirebbe, vedi sopra).
BASELINE="0015_line_full_timetable.sql"

# Quando eseguito nel container migrate, le migrations sono in /migrations.
# Quando eseguito localmente, sono in supabase/migrations/ relativo allo script.
if [ -d "/migrations" ]; then
  MIGRATIONS_DIR="/migrations"
else
  MIGRATIONS_DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"
fi

echo "▶ Connessione a: $(echo "$DB_URL" | sed 's/:\/\/[^@]*@/:\/\/***@/')"
echo "▶ Directory migrations: $MIGRATIONS_DIR"
echo ""

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
  create table if not exists schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  );"

# Bootstrap del tracking su un DB preesistente: 'routes' è creata dalla 0001,
# quindi se esiste ma il tracking è vuoto siamo su un DB già migrato a mano.
NEEDS_BASELINE="$(psql "$DB_URL" -tAc "
  select case when exists (select 1 from information_schema.tables
                            where table_schema = 'public' and table_name = 'routes')
               and not exists (select 1 from schema_migrations)
         then 1 else 0 end;")"

if [ "$NEEDS_BASELINE" = "1" ]; then
  echo "  DB preesistente senza tracking: segno come applicate le migration fino a $BASELINE"
  for f in "$MIGRATIONS_DIR"/*.sql; do
    name="$(basename "$f")"
    if [[ "$name" < "$BASELINE" || "$name" == "$BASELINE" ]]; then
      # Via stdin, non -c: psql interpola le variabili :'...' solo qui.
      echo "insert into schema_migrations (filename) values (:'fname') on conflict do nothing;" \
        | psql "$DB_URL" -v ON_ERROR_STOP=1 -q -v fname="$name"
    fi
  done
  echo ""
fi

applied=0
skipped=0
# Ordine alfabetico garantito da 0001_, 0002_, ...
mapfile -t FILES < <(ls "$MIGRATIONS_DIR"/*.sql | sort)

for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  already="$(echo "select 1 from schema_migrations where filename = :'fname';" \
    | psql "$DB_URL" -v fname="$name" -tA)"

  if [ -n "$already" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo -n "  → $name ... "
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" > /dev/null
  echo "insert into schema_migrations (filename) values (:'fname');" \
    | psql "$DB_URL" -v ON_ERROR_STOP=1 -q -v fname="$name"
  echo "✓"
  applied=$((applied + 1))
done

echo ""
echo "✓ Migrations completate ($applied applicate, $skipped già presenti)"
