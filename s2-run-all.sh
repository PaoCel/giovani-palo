#!/bin/bash
# Temporary runner for the S2 branch (not committed): every emulator test with the rules of the worktree.
set -u
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
cd "$(dirname "$0")"
(cd functions && npm ci --no-audit --no-fund >/dev/null 2>&1) && npm ci --no-audit --no-fund >/dev/null 2>&1 || { echo NPM_FAIL; exit 1; }
for p in 9199 8180 5101 9299 4400 4500 9419 8419 9519 4419 4519; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && echo "BUSY $p"; done
mkdir -p s2logs
run() {
  local name=$1 cfg=$2 proj=$3 cmd=$4
  firebase emulators:exec --config "$cfg" --project "$proj" "$cmd" > "s2logs/$name.log" 2>&1
  local rc=$?
  echo "$name rc=$rc $(grep -E '^# (pass|fail|skipped|cancelled)' "s2logs/$name.log" | tr '\n' ' ')"
}
T='node --test --test-concurrency=1 functions/tests'
node --test functions/tests/stakeMembershipMigration.test.mjs > s2logs/migration-pure.log 2>&1; echo "migration-pure rc=$? $(grep -E '^# (pass|fail)' s2logs/migration-pure.log | tr '\n' ' ')"
npm test > s2logs/client.log 2>&1; echo "client-npm-test rc=$? $(grep -E '^# (pass|fail)' s2logs/client.log | tr '\n' ' ')"
run contract firebase.membership-test.json demo-s2-contract "$T/stakeMembershipContractEmulator.test.mjs"
run migration-emu firebase.membership-test.json demo-s2-migration "$T/stakeMembershipMigrationEmulator.test.mjs"
run regupdate-py firebase.room-test.json demo-registration-rules "python3 functions/tests/registrationUpdateRules.py"
for spec in \
  "accountTypeRulesEmulator firebase.room-test.json demo-account-type" \
  "adultGuardRulesEmulator firebase.room-test.json demo-adult-guard" \
  "consentTasksRulesEmulator firebase.room-test.json demo-consent-tasks-rules" \
  "familyAnyAdultCallablesEmulator firebase.room-test.json demo-family-any-adult" \
  "familyAnyAdultRulesEmulator firebase.room-test.json demo-family-any-adult" \
  "guestLinkedAccountRulesEmulator firebase.room-test.json demo-guest-linked" \
  "parentAuthorizationCancelledEmulator firebase.room-test.json demo-parent-cancel" \
  "parentAuthorizationRestartEmulator firebase.room-test.json demo-parent-restart" \
  "parentCancelRulesEmulator firebase.room-test.json demo-parent-cancel" \
  "parentChildFlowRulesEmulator firebase.room-test.json demo-parent-child" \
  "registrationInitialStatusRulesEmulator firebase.room-test.json demo-initial-status" \
  "recordNightEmulator firebase.room-test.json demo-room-planner" \
  "recordNightGuestEmulator firebase.room-test.json demo-room-planner" \
  "recordNightGuestRulesEmulator firebase.room-test.json demo-room-planner" \
  "recordNightRulesEmulator firebase.room-test.json demo-room-planner" \
  "campStaffEmulator firebase.room-test.json demo-room-planner" \
  "campStaffSelfDeclaredRulesEmulator firebase.room-test.json demo-room-planner" \
  "parentAuthorizationSelfSignEmulator firebase.room-test.json demo-room-planner" \
  "roomManagementEmulator firebase.room-test.json demo-room-planner" \
  "roomManagementRulesEmulator firebase.room-test.json demo-room-planner" \
  "unitLeaderTripRulesEmulator firebase.room-test.json demo-room-planner" \
  "multiStakeIsolationEmulator firebase.multistake-test.json demo-room-planner" \
  "activityGalleryEmulator firebase.multistake-test.json demo-gallery-test" \
  "parentConsentEmulator firebase.multistake-test.json demo-consent-test" \
  "storageMigrationEmulator firebase.multistake-test.json demo-storage-migration" ; do
  set -- $spec
  run "$1" "$2" "$3" "$T/$1.test.mjs"
done
echo ALL_DONE
