import { test, after } from "node:test";
import assert from "node:assert/strict";

import { runScenario } from "./helpers/runner.mjs";
import {
  parityCases,
  registerErrorParityExecutors,
  compareParityResults,
  cleanupErrorParityHarnesses,
} from "./helpers/error-parity-harnesses.mjs";

registerErrorParityExecutors();

after(async () => {
  await cleanupErrorParityHarnesses();
});

for (const entry of parityCases) {
  test(`T254 parity: ${entry.id}`, async () => {
    const { results } = await runScenario(entry.id, entry.harnesses);
    const mismatches = compareParityResults(results, entry.harnesses, entry);
    assert.deepEqual(mismatches, [], `${entry.id}: ${mismatches.join("; ")}`);
  });
}
