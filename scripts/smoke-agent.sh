#!/usr/bin/env bash
# Agent-ergonomics smoke: drives the carddav MCP server via `claude -p` to
# verify the tool surface (names, descriptions, schemas, error messages) is
# usable by an LLM. Complements scripts/smoke.ts, which is a deterministic
# server-side smoke.
#
# Requires: `claude` CLI on PATH, .env populated with CARDDAV_* vars,
# project built (`npm run build`).

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v claude >/dev/null 2>&1; then
	echo "claude CLI not found on PATH" >&2
	exit 1
fi

if [ ! -f dist/index.js ]; then
	echo "dist/index.js missing — run 'npm run build' first" >&2
	exit 1
fi

PROMPT=$(cat <<'EOF'
I want to add a clearly marked test contact to my address book so I can
confirm my contact sync is working end-to-end. Use whichever of my
address books comes up first. Give the contact an obviously fake name,
one email address, and one phone number. After it's saved, change the
contact's name so I can tell it actually updated, then look the contact
up again to confirm the new name is showing and the email survived the
update, and finally remove it so it doesn't clutter my address book. If
something goes sideways partway through, please still try to clean up
the test contact before you stop.

One last thing: as a sanity check, deliberately ask for a contact using
a made-up UID like "definitely-not-a-real-uid" and tell me whether the
server responded with a clean error or blew up.

Report back as JSON matching the provided schema, one entry per
contact tool you exercised. Set ok=false for any tool that errored
unexpectedly and include the raw error string.
EOF
)

SCHEMA='{
  "type": "object",
  "properties": {
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "ok": {"type": "boolean"},
          "response_summary": {"type": "string"},
          "error": {"type": ["string", "null"]}
        },
        "required": ["name", "ok"]
      }
    },
    "bad_input_test": {
      "type": "object",
      "properties": {
        "tool": {"type": "string"},
        "graceful_error": {"type": "boolean"},
        "error_message": {"type": "string"}
      },
      "required": ["tool", "graceful_error"]
    }
  },
  "required": ["tools", "bad_input_test"]
}'

result=$(claude -p "$PROMPT" \
	--mcp-config .mcp.json \
	--allowedTools "mcp__carddav__*" \
	--output-format json \
	--json-schema "$SCHEMA")

echo "$result" | jq '.structured_output'

pass_tools=$(echo "$result" | jq -e '.structured_output.tools | all(.ok == true)' >/dev/null && echo yes || echo no)
pass_bad=$(echo "$result" | jq -e '.structured_output.bad_input_test.graceful_error == true' >/dev/null && echo yes || echo no)

if [ "$pass_tools" = "yes" ] && [ "$pass_bad" = "yes" ]; then
	echo "✅ agent smoke passed"
else
	echo "❌ agent smoke failed (tools=$pass_tools bad_input=$pass_bad)" >&2
	exit 1
fi
