#!/usr/bin/env bash
# Applica tutte le migrations in ordine sul database indicato da DATABASE_URL.
# Uso:  DATABASE_URL=postgres://... ./scripts/migrate.sh
#   oppure, da docker compose:
#         docker compose run --rm app sh scripts/migrate.sh
set -euo pipefail

DB_URL="${DATABASE_URL:?DATABASE_URL è richiesta (es: postgres://user:pass@host:5432/db)}"

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"

echo "▶ Connessione a: $(echo "$DB_URL" | sed 's/:\/\/[^@]*@/:\/\/***@/')"
echo "▶ Directory migrations: $MIGRATIONS_DIR"
echo ""

# Elenca i file in ordine alfabetico (0001_, 0002_, ... garantisce l'ordine corretto).
mapfile -t FILES < <(ls "$MIGRATIONS_DIR"/*.sql | sort)

for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  echo -n "  → $name ... "
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" > /dev/null
  echo "✓"
done

echo ""
echo "✓ Migrations completate (${#FILES[@]} file applicati)"
