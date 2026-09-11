#!/bin/bash
set -euo pipefail
IFS= read -r new_password
if [ ${#new_password} -lt 16 ] || [ ${#new_password} -gt 128 ]; then
  echo "A senha deve possuir entre 16 e 128 caracteres" >&2
  exit 2
fi
password_hash=$(printf %s "$new_password" | sha256sum | cut -d' ' -f1)
config_file=/opt/akvorado/docker/clickhouse/noc-agent-readonly.xml
backup_file="${config_file}.bak"
cp "$config_file" "$backup_file"
sed -i "s#<password_sha256_hex>[^<]*</password_sha256_hex>#<password_sha256_hex>${password_hash}</password_sha256_hex>#" "$config_file"
if ! docker exec akvorado-clickhouse-1 clickhouse-client --query 'SYSTEM RELOAD CONFIG'; then
  cp "$backup_file" "$config_file"
  docker exec akvorado-clickhouse-1 clickhouse-client --query 'SYSTEM RELOAD CONFIG' || true
  exit 3
fi
echo rotated
