import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import App from '../../src/App.vue';
import { handleAIRequest, type AIResponse } from '../../src/worker/ai-worker';

enableAutoUnmount(afterEach);

// Control only the worker transport; App, useGame, and board logic stay real.
function createWorkerTransport() {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent<AIResponse>) => void) | null,
    onerror: null,
    onmessageerror: null,
  };
}

let workers: ReturnType<typeof createWorkerTransport>[];

beforeEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
  workers = [];
  vi.stubGlobal('Worker', vi.fn(function () {
    const worker = createWorkerTransport();
    workers.push(worker);
    return worker;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', window.location.pathname);
});

function gameRecord(wrapper: VueWrapper): string {
  return (wrapper.get('#game-record').element as HTMLTextAreaElement).value;
}

function buttonNamed(wrapper: VueWrapper, name: string) {
  return wrapper.findAll('button').find(button => button.text() === name)!;
}

test('human moves update the board and record; undo removes one move and new game clears it', async () => {
  const wrapper = mount(App);
  await wrapper.get('input[name="white-mode"][value="human"]').setValue(true);
  for (const point of [40, 30, 50]) {
    await wrapper.findAll('.board button')[point].trigger('click');
  }
  expect(gameRecord(wrapper)).toBe('B9 e5 d4 f6');
  expect(wrapper.findAll('.board button')[40].classes()).toContain('stone-black');
  expect(wrapper.findAll('.board button')[30].classes()).toContain('stone-white');
  expect(wrapper.findAll('.board button')[50].classes()).toContain('stone-black');
  expect(wrapper.get('#status').text()).toBe('white to move');

  await buttonNamed(wrapper, 'Undo').trigger('click');
  expect(gameRecord(wrapper)).toBe('B9 e5 d4');
  expect(wrapper.findAll('.board button')[50].text()).toBe('');

  await buttonNamed(wrapper, 'New game').trigger('click');
  expect(gameRecord(wrapper)).toBe('B9');
  expect(wrapper.findAll('.stone-black, .stone-white')).toHaveLength(0);
  expect(wrapper.get('#status').text()).toBe('black to move');
});

test('loading a different board size updates the board, record, and controls', async () => {
  const wrapper = mount(App);
  await wrapper.get('#load-input').setValue('B11 f6 e5');
  await buttonNamed(wrapper, 'Load game').trigger('click');
  expect(gameRecord(wrapper)).toBe('B11 f6 e5');
  expect(wrapper.findAll('.board button')).toHaveLength(121);
  expect(wrapper.findAll('.board button')[60].classes()).toContain('stone-black');
  expect(wrapper.findAll('.board button')[48].classes()).toContain('stone-white');
  expect((wrapper.get('.board-size-select').element as HTMLSelectElement).value).toBe('11');
});

test.each(['black', 'white'] as const)('switching the current %s player to AI submits its position and time limit', async player => {
  const wrapper = mount(App);
  await wrapper.get('input[name="white-mode"][value="human"]').setValue(true);
  if (player === 'white') {
    await wrapper.findAll('.board button')[40].trigger('click');
  }
  await wrapper.findAll('input[type="number"]')[player === 'black' ? 0 : 1].setValue('125');
  await wrapper.get(`input[name="${player}-mode"][value="ai"]`).setValue(true);
  expect(workers).toHaveLength(1);
  expect(workers[0].postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    encodedGame: player === 'black' ? 'B9' : 'B9 e5',
    timeLimitMs: 125,
    maxDepth: 30,
    quiescenceDepth: 4,
    maxPly: 96,
  }));
  expect(wrapper.findAll('.board button').every(button => (button.element as HTMLButtonElement).disabled)).toBe(true);
});

test('loading a game cancels a pending search and ignores its later response', async () => {
  const wrapper = mount(App);
  await wrapper.get('input[name="black-mode"][value="ai"]').setValue(true);
  expect(workers).toHaveLength(1);
  const oldWorker = workers[0];
  const reply = handleAIRequest({
    encodedGame: 'B9',
    timeLimitMs: 1_000,
    maxDepth: 1,
    quiescenceDepth: 0,
    maxPly: 64,
  });
  expect(reply.move).toBe(40);

  await wrapper.get('input[name="black-mode"][value="human"]').setValue(true);
  await wrapper.get('#load-input').setValue('B9 a1 a2');
  await buttonNamed(wrapper, 'Load game').trigger('click');
  oldWorker.onmessage!({ data: reply } as MessageEvent<AIResponse>);
  await nextTick();
  expect(gameRecord(wrapper)).toBe('B9 a1 a2');
  expect(wrapper.findAll('.board button')[40].text()).toBe('');
  expect(wrapper.get('#status').text()).toBe('black to move');
  expect(oldWorker.terminate).toHaveBeenCalledTimes(1);
});
