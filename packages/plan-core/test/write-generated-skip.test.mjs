import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlanStore } from '../dist/index.js';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function mkRoot(name) {
  const root = join(tmpdir(), `agent-plan-write-generated-skip-${name}-${Date.now()}`);
  await rm(root, { recursive: true, force: true });
  return root;
}

describe('writeGenerated skips unchanged files', () => {
  it('produces PLAN.md during init and skips it on no-change re-render', async () => {
    const root = await mkRoot('skip');
    const store = new PlanStore(root);
    await store.init('Skip Test');

    const planMd = await readFile(join(root, '.local', 'generated', 'PLAN.md'), 'utf-8');
    assert.ok(planMd.includes('Skip Test'), 'PLAN.md should exist after init');

    const second = await store.writeGenerated();
    assert.deepEqual(second, [], 'second render should write nothing when unchanged');
  });

  it('rewrites PLAN.md when project metadata changes', async () => {
    const root = await mkRoot('change');
    const store = new PlanStore(root);
    await store.init('Skip Test');

    const plan = await store.loadAll();
    plan.project.description = 'changed description';
    await store.saveProject(plan.project);

    const written = await store.writeGenerated();
    assert.ok(written.includes('PLAN.md'), 'PLAN.md should be rewritten after change');

    const planMd = await readFile(join(root, '.local', 'generated', 'PLAN.md'), 'utf-8');
    assert.ok(planMd.includes('changed description'), 'PLAN.md should contain new description');
  });
});
