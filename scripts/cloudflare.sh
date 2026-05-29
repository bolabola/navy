#!/usr/bin/env bash
set -euo pipefail

API_BASE="https://api.cloudflare.com/client/v4"
LOCAL_TOKEN_FILE=".cloudflare-token.local"
USER_ENV_FILE="${HOME}/.config/board-trello/cloudflare.env"
WRANGLER_TOML="wrangler.toml"
DEPLOY_WRANGLER_TOML=".wrangler.deploy.toml"

ACCOUNT_ID=""
WORKER_NAME="board-trello"
KV_BINDING="BOARD_KV"
TOKEN_NAME="board-trello-deploy"

CREATE_DEPLOY_TOKEN=false
SET_TOKEN=false
PREPARE_KV=false
SET_SECRETS=false
DEPLOY=false
ALL=false
WIZARD=false
SAVE_TOKEN_TO_USER_ENV=false
SAVE_TOKEN_TO_LOCAL_FILE=false
INSECURE_SKIP_TLS_VERIFY=false

usage() {
  cat <<'EOF'
Usage: scripts/cloudflare.sh [options]

Options:
  --create-deploy-token           Create a scoped deploy token from a bootstrap token
  --set-token                     Paste and save an existing deploy token
  --prepare-kv                    Create or reuse BOARD_KV and write .wrangler.deploy.toml
  --set-secrets                   Set production ADMIN_PASSWORD and SESSION_SECRET
  --deploy                        Deploy with Wrangler
  --all                           Run prepare-kv, set-secrets, and deploy
  --wizard                        Interactive wizard (default when no action is given)
  --account-id <id>               Cloudflare account id
  --worker-name <name>            Worker script name (default: board-trello)
  --kv-binding <name>             KV namespace title (default: BOARD_KV)
  --token-name <name>             Deploy token name (default: board-trello-deploy)
  --save-token-to-user-environment
                                  Save deploy token to ~/.config/board-trello/cloudflare.env
  --save-token-to-local-file      Save deploy token to .cloudflare-token.local
  --insecure-skip-tls-verify      Set NODE_TLS_REJECT_UNAUTHORIZED=0 for Wrangler deploy
  -h, --help                      Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --create-deploy-token) CREATE_DEPLOY_TOKEN=true ;;
    --set-token) SET_TOKEN=true ;;
    --prepare-kv) PREPARE_KV=true ;;
    --set-secrets) SET_SECRETS=true ;;
    --deploy) DEPLOY=true ;;
    --all) ALL=true ;;
    --wizard) WIZARD=true ;;
    --account-id) ACCOUNT_ID="${2:-}"; shift ;;
    --worker-name) WORKER_NAME="${2:-}"; shift ;;
    --kv-binding) KV_BINDING="${2:-}"; shift ;;
    --token-name) TOKEN_NAME="${2:-}"; shift ;;
    --save-token-to-user-environment) SAVE_TOKEN_TO_USER_ENV=true ;;
    --save-token-to-local-file) SAVE_TOKEN_TO_LOCAL_FILE=true ;;
    --insecure-skip-tls-verify) INSECURE_SKIP_TLS_VERIFY=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

if [[ "$ALL" == true ]]; then
  PREPARE_KV=true
  SET_SECRETS=true
  DEPLOY=true
fi

EXPLICIT_ACTION=false
if [[ "$CREATE_DEPLOY_TOKEN" == true || "$SET_TOKEN" == true || "$PREPARE_KV" == true || "$SET_SECRETS" == true || "$DEPLOY" == true || "$ALL" == true ]]; then
  EXPLICIT_ACTION=true
fi

if [[ "$EXPLICIT_ACTION" == false ]]; then
  WIZARD=true
fi

if [[ "$INSECURE_SKIP_TLS_VERIFY" == true ]]; then
  export NODE_TLS_REJECT_UNAUTHORIZED=0
fi

read_secret() {
  local prompt="$1"
  local value=""
  read -r -s -p "$prompt" value
  echo >&2
  if [[ -z "${value// /}" ]]; then
    echo "$prompt cannot be empty." >&2
    exit 1
  fi
  printf '%s' "$value"
}

read_yes_no() {
  local prompt="$1"
  local default_yes="${2:-true}"
  local suffix answer
  if [[ "$default_yes" == true ]]; then
    suffix="Y/n"
  else
    suffix="y/N"
  fi
  read -r -p "$prompt [$suffix] " answer
  answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$answer" ]]; then
    [[ "$default_yes" == true ]]
    return
  fi
  [[ "$answer" == "y" || "$answer" == "yes" ]]
}

read_choice() {
  local prompt="$1"
  local default="$2"
  shift 2
  local answer=""
  while true; do
    read -r -p "$prompt (default: $default) " answer
    if [[ -z "$answer" ]]; then
      printf '%s' "$default"
      return
    fi
    for option in "$@"; do
      if [[ "$answer" == "$option" ]]; then
        printf '%s' "$answer"
        return
      fi
    done
    echo "Invalid choice." >&2
  done
}

save_deploy_token() {
  local token="$1"
  export CLOUDFLARE_API_TOKEN="$token"

  if [[ "$SAVE_TOKEN_TO_USER_ENV" == true ]]; then
    mkdir -p "$(dirname "$USER_ENV_FILE")"
    printf "export CLOUDFLARE_API_TOKEN='%s'\n" "$token" >"$USER_ENV_FILE"
    chmod 600 "$USER_ENV_FILE"
    echo "Deploy token saved to $USER_ENV_FILE."
    echo "Add this to your shell profile if needed: source \"$USER_ENV_FILE\""
  fi

  if [[ "$SAVE_TOKEN_TO_LOCAL_FILE" == true ]]; then
    printf '%s' "$token" >"$LOCAL_TOKEN_FILE"
    chmod 600 "$LOCAL_TOKEN_FILE"
    echo "Deploy token saved to $LOCAL_TOKEN_FILE. This file is gitignored; treat it like a password."
  fi
}

load_user_env_token() {
  if [[ -f "$USER_ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$USER_ENV_FILE"
  fi
}

deploy_token_available() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    return 0
  fi
  load_user_env_token
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    return 0
  fi
  if [[ -f "$LOCAL_TOKEN_FILE" ]]; then
    return 0
  fi
  return 1
}

get_deploy_token() {
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    load_user_env_token
  fi
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -f "$LOCAL_TOKEN_FILE" ]]; then
    CLOUDFLARE_API_TOKEN="$(tr -d '\r\n' <"$LOCAL_TOKEN_FILE")"
    export CLOUDFLARE_API_TOKEN
  fi
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "CLOUDFLARE_API_TOKEN is not set. Run scripts/cloudflare.sh --set-token or --create-deploy-token first." >&2
    exit 1
  fi
  printf '%s' "$CLOUDFLARE_API_TOKEN"
}

cf_api() {
  local method="$1"
  local path="$2"
  local token="$3"
  local body="${4:-}"
  local response http_code tmp

  tmp="$(mktemp)"
  if [[ -n "$body" ]]; then
    http_code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      --data "$body" \
      "$API_BASE$path")"
  else
    http_code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      "$API_BASE$path")"
  fi

  response="$(cat "$tmp")"
  rm -f "$tmp"

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "Cloudflare API $method $path failed with HTTP $http_code" >&2
    echo "$response" >&2
    exit 1
  fi

  if [[ "$(jq -r '.success // true' <<<"$response")" != "true" ]]; then
    echo "Cloudflare API $method $path returned success=false" >&2
    echo "$response" >&2
    exit 1
  fi

  printf '%s' "$response"
}

resolve_account_id() {
  local token="$1"
  local provided="${2:-}"
  local response count index choice account_id

  if [[ -n "${provided// /}" ]]; then
    printf '%s' "$(printf '%s' "$provided" | tr -d '[:space:]')"
    return
  fi

  set +e
  response="$(cf_api GET "/accounts" "$token" 2>/dev/null)"
  local api_status=$?
  set -e
  if [[ $api_status -eq 0 && -n "$response" ]]; then
    count="$(jq -r '.result | length' <<<"$response")"
    if [[ "$count" -eq 1 ]]; then
      account_id="$(jq -r '.result[0].id' <<<"$response")"
      echo "Using Cloudflare account: $(jq -r '.result[0].name' <<<"$response") ($account_id)" >&2
      printf '%s' "$account_id"
      return
    fi
    if [[ "$count" -gt 1 ]]; then
      {
        echo "Available accounts:"
        jq -r '.result[] | "\(.name) (\(.id))"' <<<"$response" | nl -ba
      } >&2
      read -r -p "Select account number: " choice
      index=$((choice - 1))
      account_id="$(jq -r --argjson idx "$index" '.result[$idx].id' <<<"$response")"
      if [[ -n "$account_id" && "$account_id" != "null" ]]; then
        printf '%s' "$account_id"
        return
      fi
      echo "Invalid account selection." >&2
      exit 1
    fi
  else
    echo "Could not list accounts with the token." >&2
  fi

  read -r -p "Cloudflare Account ID: " account_id
  account_id="$(printf '%s' "$account_id" | tr -d '[:space:]')"
  if [[ ! "$account_id" =~ ^[0-9a-fA-F]{32}$ ]]; then
    echo "Cloudflare Account ID should be a 32-character hex string." >&2
    exit 1
  fi
  printf '%s' "$account_id"
}

find_permission_group() {
  local groups_json="$1"
  local scope="$2"
  local pattern="$3"
  local match

  match="$(jq -r --arg scope "$scope" --arg pattern "$pattern" '
    .result[]
    | select((.scopes // []) | index($scope))
    | select(.name | test($pattern))
    | .id
  ' <<<"$groups_json" | head -n 1)"

  if [[ -z "$match" ]]; then
    echo "Could not find required permission group for scope $scope matching /$pattern/." >&2
    jq -r --arg scope "$scope" '.result[] | select((.scopes // []) | index($scope)) | .name' <<<"$groups_json" >&2
    exit 1
  fi

  jq -n --arg id "$match" '{id: $id, meta: {}}'
}

new_random_hex_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
}

replace_in_file() {
  local file="$1"
  local search="$2"
  local replace="$3"
  if [[ "$OSTYPE" == darwin* ]]; then
    sed -i '' "s/${search}/${replace}/" "$file"
  else
    sed -i "s/${search}/${replace}/" "$file"
  fi
}

replace_kv_namespace_id() {
  local file="$1"
  local namespace_id="$2"
  if grep -q 'REPLACE_WITH_KV_ID' "$file"; then
    replace_in_file "$file" 'id = "REPLACE_WITH_KV_ID"' "id = \"$namespace_id\""
    return
  fi
  perl -pi -e 's/id = "[0-9a-fA-F]{32}"/id = "'"$namespace_id"'"/' "$file"
}

update_deploy_wrangler_config() {
  local namespace_id="$1"

  if [[ ! -f "$WRANGLER_TOML" ]]; then
    echo "$WRANGLER_TOML was not found." >&2
    exit 1
  fi

  cp "$WRANGLER_TOML" "$DEPLOY_WRANGLER_TOML"
  replace_kv_namespace_id "$DEPLOY_WRANGLER_TOML" "$namespace_id"

  echo "Wrote local deploy config $DEPLOY_WRANGLER_TOML with KV namespace id $namespace_id."
  echo "$WRANGLER_TOML remains safe to commit with REPLACE_WITH_KV_ID."
}

invoke_set_token() {
  local token
  token="$(read_secret "CLOUDFLARE_API_TOKEN: ")"
  save_deploy_token "$token"
  echo "Token is available for this shell session."
}

invoke_create_deploy_token() {
  local bootstrap_token resolved_account_id permission_response groups account_scope
  local workers_group kv_group settings_group resources_json body created_response deploy_token token_id

  echo "Paste a bootstrap token created with the Cloudflare 'Create additional tokens' template."
  bootstrap_token="$(read_secret "Bootstrap CLOUDFLARE_API_TOKEN: ")"
  resolved_account_id="$(resolve_account_id "$bootstrap_token" "$ACCOUNT_ID")"
  permission_response="$(cf_api GET "/user/tokens/permission_groups" "$bootstrap_token")"
  account_scope="com.cloudflare.api.account"
  # Cloudflare permission group labels vary across API generations. Prefer "Write" groups.
  workers_group="$(find_permission_group "$permission_response" "$account_scope" '^Workers Scripts (Write|Edit)$')"
  kv_group="$(find_permission_group "$permission_response" "$account_scope" '^Workers KV Storage (Write|Edit)$')"
  settings_group="$(find_permission_group "$permission_response" "$account_scope" '^Account Settings Read$')"

  resources_json="$(jq -n --arg account "$resolved_account_id" '{("com.cloudflare.api.account." + $account): "*"}')"
  body="$(jq -n \
    --arg name "$TOKEN_NAME" \
    --argjson resources "$resources_json" \
    --argjson workers "$workers_group" \
    --argjson kv "$kv_group" \
    --argjson settings "$settings_group" \
    '{
      name: $name,
      policies: [{
        effect: "allow",
        resources: $resources,
        permission_groups: [$workers, $kv, $settings]
      }]
    }')"

  created_response="$(cf_api POST "/user/tokens" "$bootstrap_token" "$body")"
  deploy_token="$(jq -r '.result.value // .result.token // empty' <<<"$created_response")"
  token_id="$(jq -r '.result.id // empty' <<<"$created_response")"
  if [[ -z "$deploy_token" ]]; then
    echo "Token was created, but Cloudflare did not return the token value." >&2
    exit 1
  fi

  save_deploy_token "$deploy_token"
  echo "Deploy token created. Token id: $token_id"
}

invoke_prepare_kv() {
  local token resolved_account_id namespaces_response namespace_id created_response

  token="$(get_deploy_token)"
  resolved_account_id="$(resolve_account_id "$token" "$ACCOUNT_ID")"
  namespaces_response="$(cf_api GET "/accounts/$resolved_account_id/storage/kv/namespaces" "$token")"
  namespace_id="$(jq -r --arg title "$KV_BINDING" '.result[] | select(.title == $title) | .id' <<<"$namespaces_response" | head -n 1)"

  if [[ -z "$namespace_id" ]]; then
    created_response="$(cf_api POST "/accounts/$resolved_account_id/storage/kv/namespaces" "$token" "$(jq -n --arg title "$KV_BINDING" '{title: $title}')")"
    namespace_id="$(jq -r '.result.id' <<<"$created_response")"
    echo "Created KV namespace $KV_BINDING ($namespace_id)."
  else
    echo "Using existing KV namespace $KV_BINDING ($namespace_id)."
  fi

  update_deploy_wrangler_config "$namespace_id"
}

invoke_set_secrets() {
  local token resolved_account_id admin_password session_secret body response

  token="$(get_deploy_token)"
  resolved_account_id="$(resolve_account_id "$token" "$ACCOUNT_ID")"
  echo "Enter the production admin password. It will not be displayed."
  admin_password="$(read_secret "ADMIN_PASSWORD: ")"
  if [[ ${#admin_password} -lt 16 ]]; then
    echo "ADMIN_PASSWORD should be at least 16 characters for production." >&2
    exit 1
  fi
  session_secret="$(new_random_hex_secret)"

  for secret_name in ADMIN_PASSWORD SESSION_SECRET; do
    if [[ "$secret_name" == "ADMIN_PASSWORD" ]]; then
      body="$(jq -n --arg name "$secret_name" --arg text "$admin_password" '{name: $name, text: $text, type: "secret_text"}')"
    else
      body="$(jq -n --arg name "$secret_name" --arg text "$session_secret" '{name: $name, text: $text, type: "secret_text"}')"
    fi
    response="$(cf_api PUT "/accounts/$resolved_account_id/workers/scripts/$WORKER_NAME/secrets" "$token" "$body")"
    if [[ "$(jq -r '.success' <<<"$response")" != "true" ]]; then
      echo "Cloudflare API failed to set $secret_name." >&2
      exit 1
    fi
    echo "Set secret: $secret_name"
  done
}

invoke_deploy() {
  get_deploy_token >/dev/null
  require_cmd node

  local wrangler_cli="node_modules/wrangler/bin/wrangler.js"
  if [[ ! -f "$wrangler_cli" ]]; then
    echo "Wrangler CLI was not found. Run npm install first." >&2
    exit 1
  fi

  if [[ -f "$DEPLOY_WRANGLER_TOML" ]]; then
    node "$wrangler_cli" deploy --config "$DEPLOY_WRANGLER_TOML"
  else
    node "$wrangler_cli" deploy
  fi
}

invoke_deploy_with_retry() {
  set +e
  invoke_deploy
  local status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    return 0
  fi

  if [[ "$INSECURE_SKIP_TLS_VERIFY" == true ]]; then
    return "$status"
  fi

  echo "Deploy failed."
  echo "If your network uses a proxy or VPN that breaks Wrangler TLS validation, you can retry with NODE_TLS_REJECT_UNAUTHORIZED=0."
  echo "Only use this on your own trusted network."
  if ! read_yes_no "Retry deploy with insecure TLS verification disabled" false; then
    return "$status"
  fi

  INSECURE_SKIP_TLS_VERIFY=true
  export NODE_TLS_REJECT_UNAUTHORIZED=0
  invoke_deploy
}

invoke_wizard() {
  local mode should_set_secrets should_deploy

  echo "Cloudflare deployment wizard for $WORKER_NAME"

  if ! deploy_token_available; then
    echo "No deploy token was found in the session, user environment, or $LOCAL_TOKEN_FILE."
    mode="$(read_choice "Choose token setup: 1=paste existing deploy token, 2=create deploy token from bootstrap token" "1" "1" "2")"
    if read_yes_no "Save deploy token to $LOCAL_TOKEN_FILE for this project" true; then
      SAVE_TOKEN_TO_LOCAL_FILE=true
    fi
    if [[ "$mode" == "1" ]]; then
      invoke_set_token
    else
      invoke_create_deploy_token
    fi
  else
    get_deploy_token >/dev/null
    echo "Using existing deploy token."
  fi

  if read_yes_no "Prepare KV namespace and local deploy config" true; then
    invoke_prepare_kv
  fi

  should_set_secrets=false
  if read_yes_no "Set or reset production ADMIN_PASSWORD and SESSION_SECRET" false; then
    should_set_secrets=true
  fi

  should_deploy=false
  if read_yes_no "Deploy now" true; then
    should_deploy=true
  fi

  if [[ "$should_deploy" == true ]]; then
    invoke_deploy_with_retry
  fi

  if [[ "$should_set_secrets" == true ]]; then
    invoke_set_secrets
  fi
}

if [[ "$WIZARD" == true ]]; then
  invoke_wizard
fi
if [[ "$SET_TOKEN" == true ]]; then
  invoke_set_token
fi
if [[ "$CREATE_DEPLOY_TOKEN" == true ]]; then
  invoke_create_deploy_token
fi
if [[ "$PREPARE_KV" == true ]]; then
  invoke_prepare_kv
fi
if [[ "$DEPLOY" == true ]]; then
  invoke_deploy_with_retry
fi
if [[ "$SET_SECRETS" == true ]]; then
  invoke_set_secrets
fi
