#!/usr/bin/env bash
# L0 smoke-test aggregator. See specs/00-l0-smoke-tests.md.
#
# Recommended invocation:
#   infisical run \
#     --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
#     --env dev \
#     --domain https://secrets.intentralabs.com \
#     -- ./tools/smoke-tests/run-all.sh
#
# Exit codes:
#   0    all probes either PASS or SKIP
#   1    at least one probe FAILed

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBES=(infisical cf aws rpc ens erc8004 kh d1)

# Soft check that we are running under infisical run; warn but continue.
if [[ -z "${INFISICAL_TOKEN:-}" ]]; then
  echo "warning: INFISICAL_TOKEN unset — secrets may not hydrate. Prefer:"
  echo "  infisical run --env dev -- $0"
  echo
fi

declare -a STATUSES DURATIONS NOTES
total_t0_ms=$(($(date +%s%N) / 1000000))
overall_rc=0

for probe in "${PROBES[@]}"; do
  script="$DIR/${probe}.sh"
  if [[ ! -x "$script" ]]; then
    chmod +x "$script" 2>/dev/null || true
  fi

  out="$("$script" 2>&1)"
  rc=$?

  # Parse output: each probe emits "<STATUS> <name> <ms> [note]" once,
  # but multi-line FAIL/SKIP context can interleave. Grep the canonical
  # summary line (status anchor at line start, followed by " <name> ").
  last="$(echo "$out" | grep -E "^(PASS|SKIP|FAIL) ${probe} " | tail -n1)"
  read -r status name dur rest <<<"$last" || true

  case "$status" in
    PASS|SKIP)
      :
      ;;
    FAIL)
      overall_rc=1
      ;;
    *)
      status=FAIL
      dur="?ms"
      rest="$out"
      overall_rc=1
      ;;
  esac

  STATUSES+=("$status")
  DURATIONS+=("$dur")
  NOTES+=("$rest")
done

total_dur_ms=$(( $(($(date +%s%N) / 1000000)) - total_t0_ms ))

echo
printf '%-12s  %-6s  %-10s  %s\n' PROBE STATUS DURATION NOTES
printf '%-12s  %-6s  %-10s  %s\n' ------------ ------ ---------- -----
for i in "${!PROBES[@]}"; do
  printf '%-12s  %-6s  %-10s  %s\n' \
    "${PROBES[$i]}" "${STATUSES[$i]}" "${DURATIONS[$i]}" "${NOTES[$i]}"
done
echo
echo "total: ${total_dur_ms}ms"
if (( overall_rc == 0 )); then
  echo "outcome: ALL PASS (or SKIP)"
else
  echo "outcome: AT LEAST ONE FAIL"
fi

exit "$overall_rc"
