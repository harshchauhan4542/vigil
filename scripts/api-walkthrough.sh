#!/usr/bin/env bash
# Walk one exception through the full flow over HTTP against a running app (pnpm dev).
#   BASE=http://localhost:3000 scripts/api-walkthrough.sh
# Live mode needs PayPal + Anthropic keys in .env and seeded sandbox data (pnpm seed).
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

echo "== health";      curl -sf -c "$JAR" -b "$JAR" "$BASE/api/health"; echo
echo "== queue";       curl -sf -c "$JAR" -b "$JAR" "$BASE/api/exceptions" | head -c 600; echo
PID="$(curl -sf -b "$JAR" "$BASE/api/exceptions" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const q=JSON.parse(s).exceptions.find(e=>e.latestProposal?.status==="PENDING_APPROVAL");
    process.stdout.write(q?q.latestProposal.id:"");});')"
if [ -z "$PID" ]; then echo "No proposal awaiting approval (run detect: pnpm flow)"; exit 0; fi
echo "== proposal $PID"; curl -sf -b "$JAR" "$BASE/api/proposals/$PID" | head -c 800; echo
echo "== approve";     curl -s -c "$JAR" -b "$JAR" -X POST -H 'content-type: application/json' -d '{}' "$BASE/api/proposals/$PID/approve"; echo
sleep 3
echo "== after";       curl -sf -b "$JAR" "$BASE/api/proposals/$PID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.proposal.status, r.executions.map(x=>[x.attempt,x.httpStatus,x.paypalRequestId,x.debugId]))})'
echo "== audit chain"; curl -sf -b "$JAR" "$BASE/api/audit" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).chain))'
