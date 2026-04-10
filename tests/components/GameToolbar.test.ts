import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import GameToolbar from '../../src/components/GameToolbar.vue';

describe('GameToolbar', () => {
  const defaultProps = {
    blackIsAI: false,
    whiteIsAI: true,
    blackTimeLimit: 75,
    whiteTimeLimit: 75,
    blackAIType: 'classic' as const,
    whiteAIType: 'classic' as const,
    boardSize: 9 as const,
    aiThinking: false,
  };

  test('renders all controls', () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });

    expect(wrapper.findAll('fieldset').length).toBe(2);
    expect(wrapper.findAll('input[type="radio"]').length).toBe(4);
    expect(wrapper.findAll('input[type="number"]').length).toBe(2);
    // board-size select + white AI type select (whiteIsAI=true)
    expect(wrapper.findAll('select').length).toBe(2);
    expect(wrapper.findAll('button').length).toBe(2);
  });

  test('renders AI type select only when AI is selected', () => {
    const bothHumanProps = { ...defaultProps, whiteIsAI: false };
    const wrapper = mount(GameToolbar, { props: bothHumanProps });
    // Only the board size select when both are human
    expect(wrapper.findAll('select').length).toBe(1);
  });

  test('renders AI type select for black when blackIsAI is true', () => {
    const wrapper = mount(GameToolbar, { props: { ...defaultProps, blackIsAI: true } });
    // board-size + black AI type + white AI type
    expect(wrapper.findAll('select').length).toBe(3);
  });

  test('black human radio is checked when blackIsAI is false', () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const blackRadios = wrapper.findAll('input[name="black-mode"]');
    expect((blackRadios[0].element as HTMLInputElement).checked).toBe(true); // human
    expect((blackRadios[1].element as HTMLInputElement).checked).toBe(false); // ai
  });

  test('white AI radio is checked when whiteIsAI is true', () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const whiteRadios = wrapper.findAll('input[name="white-mode"]');
    expect((whiteRadios[0].element as HTMLInputElement).checked).toBe(false); // human
    expect((whiteRadios[1].element as HTMLInputElement).checked).toBe(true); // ai
  });

  test('emits update:blackIsAI when black mode changes to AI', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const aiRadio = wrapper.findAll('input[name="black-mode"]')[1];
    await aiRadio.setValue(true);
    expect(wrapper.emitted('update:blackIsAI')).toBeTruthy();
    expect(wrapper.emitted('update:blackIsAI')![0]).toEqual([true]);
  });

  test('emits update:blackIsAI when black mode changes to human', async () => {
    const wrapper = mount(GameToolbar, { props: { ...defaultProps, blackIsAI: true } });
    const humanRadio = wrapper.findAll('input[name="black-mode"]')[0];
    await humanRadio.setValue(true);
    expect(wrapper.emitted('update:blackIsAI')).toBeTruthy();
    expect(wrapper.emitted('update:blackIsAI')![0]).toEqual([false]);
  });

  test('emits update:whiteIsAI when white mode changes', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const humanRadio = wrapper.findAll('input[name="white-mode"]')[0];
    await humanRadio.setValue(true);
    expect(wrapper.emitted('update:whiteIsAI')).toBeTruthy();
    expect(wrapper.emitted('update:whiteIsAI')![0]).toEqual([false]);
  });

  test('emits update:whiteIsAI with true when AI radio selected', async () => {
    const wrapper = mount(GameToolbar, { props: { ...defaultProps, whiteIsAI: false } });
    const aiRadio = wrapper.findAll('input[name="white-mode"]')[1];
    await aiRadio.setValue(true);
    expect(wrapper.emitted('update:whiteIsAI')![0]).toEqual([true]);
  });

  test('emits update:blackTimeLimit on change', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const input = wrapper.findAll('input[type="number"]')[0];
    await input.setValue('150');
    await input.trigger('change');
    expect(wrapper.emitted('update:blackTimeLimit')).toBeTruthy();
    expect(wrapper.emitted('update:blackTimeLimit')![0]).toEqual([150]);
  });

  test('emits update:blackTimeLimit clamps to min 1', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const input = wrapper.findAll('input[type="number"]')[0];
    await input.setValue('0');
    await input.trigger('change');
    expect(wrapper.emitted('update:blackTimeLimit')![0]).toEqual([75]);
  });

  test('emits update:whiteTimeLimit on change', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const input = wrapper.findAll('input[type="number"]')[1];
    await input.setValue('200');
    await input.trigger('change');
    expect(wrapper.emitted('update:whiteTimeLimit')).toBeTruthy();
    expect(wrapper.emitted('update:whiteTimeLimit')![0]).toEqual([200]);
  });

  test('emits update:whiteTimeLimit clamps to default for invalid input', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const input = wrapper.findAll('input[type="number"]')[1];
    await input.setValue('abc');
    await input.trigger('change');
    expect(wrapper.emitted('update:whiteTimeLimit')![0]).toEqual([75]);
  });

  test('emits update:boardSize on select change', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const select = wrapper.find('.board-size-select');
    await select.setValue('13');
    expect(wrapper.emitted('update:boardSize')).toBeTruthy();
    expect(wrapper.emitted('update:boardSize')![0]).toEqual([13]);
  });

  test('emits update:whiteAIType when white AI type select changes', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    // whiteIsAI=true so white AI type select is visible
    const selects = wrapper.findAll('select');
    // First select is white AI type (rendered before board-size when whiteIsAI=true, blackIsAI=false)
    // Actually the white AI type select appears inside the white fieldset, board-size select is last
    const whiteAITypeSelect = wrapper.find('fieldset:last-of-type select');
    await whiteAITypeSelect.setValue('classic');
    expect(wrapper.emitted('update:whiteAIType')).toBeTruthy();
    expect(wrapper.emitted('update:whiteAIType')![0]).toEqual(['classic']);
  });

  test('emits update:blackAIType when black AI type select changes', async () => {
    const wrapper = mount(GameToolbar, { props: { ...defaultProps, blackIsAI: true } });
    const blackAITypeSelect = wrapper.find('fieldset:first-of-type select');
    await blackAITypeSelect.setValue('classic');
    expect(wrapper.emitted('update:blackAIType')).toBeTruthy();
    expect(wrapper.emitted('update:blackAIType')![0]).toEqual(['classic']);
  });

  test('emits newGame when New game button is clicked', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const buttons = wrapper.findAll('button');
    await buttons[0].trigger('click');
    expect(wrapper.emitted('newGame')).toBeTruthy();
  });

  test('emits undo when Undo button is clicked', async () => {
    const wrapper = mount(GameToolbar, { props: defaultProps });
    const buttons = wrapper.findAll('button');
    await buttons[1].trigger('click');
    expect(wrapper.emitted('undo')).toBeTruthy();
  });

  test('displays correct board size in select', () => {
    const wrapper = mount(GameToolbar, { props: { ...defaultProps, boardSize: 13 as const } });
    const select = wrapper.find('.board-size-select');
    expect((select.element as HTMLSelectElement).value).toBe('13');
  });

  test('displays correct white AI type in select', () => {
    const wrapper = mount(GameToolbar, { props: { ...defaultProps, whiteAIType: 'classic' as const } });
    const select = wrapper.find('fieldset:last-of-type select');
    expect((select.element as HTMLSelectElement).value).toBe('classic');
  });
});
