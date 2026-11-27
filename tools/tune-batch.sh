#!/bin/sh
# Retunes several levels at once on one computer (Work item 13nov): for each level and seed,
# tools/traps.mjs design --tune, at most $MINUTES minutes each, its lines kept in tune/L<n>-s<seed>.jsonl
# (the last line is the best board found so far, or the result). START='["red 90, ...", ...]' starts
# from those lines instead of the level's own. Levels to measure only: MEASURE="9 14" writes
# tools/difficulty.mjs's line to tune/M<n>.txt.
#   LEVELS="6 7" SEEDS="1 2" MINUTES=90 sh tools/tune-batch.sh
mkdir -p tune
limit() { perl -e 'alarm shift; exec @ARGV' "$@"; }
for n in $LEVELS; do for s in ${SEEDS:-1}; do
  if [ -n "$START" ]; then
    limit $((${MINUTES:-90} * 60)) node --import "data:text/javascript,import { LEVELS } from 'file://$(pwd)/js/levels.js'; LEVELS[$((n - 1))] = { ...LEVELS[$((n - 1))], lines: $START };" \
      tools/traps.mjs design --level=$n --tune --seed=$s --steps=${STEPS:-400} > tune/L$n-${TAG:-s}$s.jsonl 2>&1 &
  else
    limit $((${MINUTES:-90} * 60)) node tools/traps.mjs design --level=$n --tune --seed=$s --steps=${STEPS:-400} > tune/L$n-${TAG:-s}$s.jsonl 2>&1 &
  fi
done; done
for n in $MEASURE; do limit $((${MINUTES:-90} * 60)) node tools/difficulty.mjs $n > tune/M$n.txt 2>&1 & done
wait
echo finished
