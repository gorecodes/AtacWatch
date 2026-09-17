#!/usr/bin/env bash
# Applica tutte le migrations in ordine sul database indicato da DATABASE_URL.
#
# Uso diretto (richiede psql installato localmente):
#   DATABASE_URL=postgres://... ./scripts/migrate.sh
#
# Uso consigliato via Docker (niente psql richiesto):
#   docker compose run --rm migrate
#
set -euo pipefail

DB_URL="${DATABASE_URL:?DATABASE_URL è richiesta (es: postgres://user:pass@host:5432/db)}"

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

# Ordine alfabetico garantito da 0001_, 0002_, ...
mapfile -t FILES < <(ls "$MIGRATIONS_DIR"/*.sql | sort)

for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  echo -n "  → $name ... "
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" > /dev/null
  echo "✓"
done

echo ""
echo "✓ Migrations completate (${#FILES[@]} file applicati)"
