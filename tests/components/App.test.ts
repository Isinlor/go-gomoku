import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, shallowRef, computed } from 'vue';
import { GogoPosition } from '../../src/engine';

const mockGameState = () => {
  const game = shallowRef(new GogoPosition(9));
  return {
    size: ref(9),
    game,
    blackIsAI: ref(false),
    whiteIsAI: ref(true),
    blackTimeLimit: ref(75),
    whiteTimeLimit: ref(75),
    aiThinking: ref(false),
    statusText: computed(() => 'black to move'),
    statusExtra: ref(''),
    gameRecord: computed(() => 'B9'),
    gameUrl: computed(() => '#B9'),
    loadError: ref(''),
    boardVersion: ref(0),
    boardDisabled: () => false,
    newGame: vi.fn(),
    undo: vi.fn(),
    playMove: vi.fn(),
    loadGame: vi.fn(),
    setSize: vi.fn(),
    onModeChange: vi.fn(),
    tryLoadFromUrl: vi.fn(),
    maybeRunAI: vi.fn(),
    isAITurn: vi.fn(() => false),
    isCurrentPlayerHuman: vi.fn(() => true),
    terminateWorker: vi.fn(),
  };
};

let currentMockState: ReturnType<typeof mockGameState>;

vi.mock('../../src/composables/useGame', () => ({
  useGame: () => {
    currentMockState = mockGameState();
    return currentMockState;
  },
}));

// Must import App after mock setup
import App from '../../src/App.vue';

describe('App', () => {
  test('renders the app with all child components', () => {
    const wrapper = mount(App);
    expect(wrapper.find('#status').exists()).toBe(true);
    expect(wrapper.find('#status').text()).toBe('black to move');
    expect(wrapper.find('.hint').exists()).toBe(true);
  });

  test('renders GameToolbar, BoardGrid, GameRecord and LoadGame sections', () => {
    const wrapper = mount(App);
    expect(wrapper.find('.toolbar').exists()).toBe(true);
    expect(wrapper.find('.board').exists()).toBe(true);
    expect(wrapper.find('.game-record-section').exists()).toBe(true);
    expect(wrapper.find('.load-section').exists()).toBe(true);
  });

  test('onUpdateBlackIsAI updates blackIsAI and calls onModeChange', async () => {
    const wrapper = mount(App);
    const toolbar = wrapper.findComponent({ name: 'GameToolbar' });
    toolbar.vm.$emit('update:blackIsAI', true);
    await wrapper.vm.$nextTick();
    expect(currentMockState.onModeChange).toHaveBeenCalled();
  });

  test('onUpdateWhiteIsAI updates whiteIsAI and calls onModeChange', async () => {
    const wrapper = mount(App);
    const toolbar = wrapper.findComponent({ name: 'GameToolbar' });
    toolbar.vm.$emit('update:whiteIsAI', false);
    await wrapper.vm.$nextTick();
    expect(currentMockState.onModeChange).toHaveBeenCalled();
  });

  test('onUpdateBoardSize calls setSize', async () => {
    const wrapper = mount(App);
    const toolbar = wrapper.findComponent({ name: 'GameToolbar' });
    toolbar.vm.$emit('update:boardSize', 13);
    await wrapper.vm.$nextTick();
    expect(currentMockState.setSize).toHaveBeenCalledWith(13);
  });

  test('onCopyUrl calls clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const wrapper = mount(App);
    const record = wrapper.findComponent({ name: 'GameRecord' });
    record.vm.$emit('copyUrl');
    await wrapper.vm.$nextTick();
    expect(writeText).toHaveBeenCalled();
  });

  test('onCopyUrl falls back to prompt when clipboard fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('fail'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const promptSpy = vi.fn();
    vi.stubGlobal('prompt', promptSpy);

    const wrapper = mount(App);
    const record = wrapper.findComponent({ name: 'GameRecord' });
    record.vm.$emit('copyUrl');

    await new Promise((r) => setTimeout(r, 10));
    expect(promptSpy).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test('inline blackTimeLimit update handler sets the ref', async () => {
    const wrapper = mount(App);
    const toolbar = wrapper.findComponent({ name: 'GameToolbar' });
    toolbar.vm.$emit('update:blackTimeLimit', 200);
    await wrapper.vm.$nextTick();
    expect(currentMockState.blackTimeLimit.value).toBe(200);
  });

  test('inline whiteTimeLimit update handler sets the ref', async () => {
    const wrapper = mount(App);
    const toolbar = wrapper.findComponent({ name: 'GameToolbar' });
    toolbar.vm.$emit('update:whiteTimeLimit', 300);
    await wrapper.vm.$nextTick();
    expect(currentMockState.whiteTimeLimit.value).toBe(300);
  });
});
