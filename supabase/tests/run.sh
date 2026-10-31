#!/usr/bin/env bash
# Lance les tests d'isolation sur un Postgres local jetable.
# Usage : bash supabase/tests/run.sh   (nécessite initdb/pg_ctl/psql 15+)
set -euo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
DATA="$(mktemp -d)"
PORT="${PORT:-54329}"

if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$DATA"
  RUN=(su postgres -c)
else
  RUN=(bash -c)
fi

"${RUN[@]}" "$PGBIN/initdb -D $DATA -U postgres -A trust >/dev/null"
"${RUN[@]}" "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA/log -w start >/dev/null"
trap '"${RUN[@]}" "$PGBIN/pg_ctl -D $DATA -m fast stop >/dev/null"; rm -rf "$DATA"' EXIT

PSQL=(psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ICI/stub_auth.sql"
for m in "$RACINE"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$m"
done
"${PSQL[@]}" -f "$ICI/acces.sql"
