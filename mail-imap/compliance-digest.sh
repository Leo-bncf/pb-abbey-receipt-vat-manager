#!/usr/bin/env bash
# Host cron entry point: dump compliance_items as JSON and pipe it into the
# digest script running inside the mail-imap container (reuses its SMTP creds).
set -euo pipefail
docker exec -i supabase-db psql -U postgres -d postgres -At -c \
  "select coalesce(json_agg(t), '[]') from (select type, unit_reference, expiry_date from public.compliance_items) t" \
| docker exec -i pbabbey-mail-imap node /app/digest.js
