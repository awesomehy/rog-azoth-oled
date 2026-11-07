import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PageState } from '../src/page-state.mjs';

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'azoth-page-state-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('azoth-page-state-'));
    await rm(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'page-state.json');
  return { directory, file, store: new PageState(file, ['temperature', 'utilization', 'codex']) };
}

test('rapid page changes persist the latest selection and an unfinished temporary write is ignored', async t => {
  const { file, store } = await setup(t);
  await Promise.all(['temperature', 'utilization', 'codex'].map(page => store.save(page)));
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { page: 'codex' });
  await writeFile(`${file}.tmp`, '{"page":');
  assert.equal(await new PageState(file, store.pages).load(), 'codex');
});

test('first upgrade migrates only the information page from legacy status', async t => {
  const { directory, file, store } = await setup(t);
  const legacy = path.join(directory, 'status.json');
  await writeFile(legacy, JSON.stringify({ state: 'adjusting', control: 'VOLUME', page: 'codex', quota: { example: 'not migrated' } }));
  assert.equal(await store.load(legacy), 'codex');
  await store.save('codex');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { page: 'codex' });
  await writeFile(legacy, '{"page":"temperature"}');
  assert.equal(await new PageState(file, store.pages).load(legacy), 'codex');
});

test('missing or damaged memory has no preference and control pages cannot be saved', async t => {
  const { file, store } = await setup(t);
  assert.equal(await store.load(), null);
  await writeFile(file, '{"page":');
  assert.equal(await store.load(), null);
  assert.throws(() => store.save('VOLUME'), /disabled information page/);
});
