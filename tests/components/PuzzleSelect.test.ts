import { describe, test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PuzzleSelect from '../../src/components/PuzzleSelect.vue';
import { PUZZLES } from '../../src/engine';

describe('PuzzleSelect', () => {
  test('renders select with all puzzles as options', () => {
    const wrapper = mount(PuzzleSelect);
    const options = wrapper.findAll('option');
    // 1 placeholder + PUZZLES.length
    expect(options.length).toBe(1 + PUZZLES.length);
    expect(options[0].text()).toBe('Select a puzzle…');
  });

  test('emits loadPuzzle with the selected puzzle', async () => {
    const wrapper = mount(PuzzleSelect);
    const select = wrapper.find('#puzzle-select');
    await select.setValue(PUZZLES[0].id);
    expect(wrapper.emitted('loadPuzzle')).toBeTruthy();
    expect(wrapper.emitted('loadPuzzle')![0]).toEqual([PUZZLES[0]]);
  });

  test('does not emit when empty value is selected', async () => {
    const wrapper = mount(PuzzleSelect);
    const select = wrapper.find('#puzzle-select');
    await select.setValue('');
    expect(wrapper.emitted('loadPuzzle')).toBeUndefined();
  });

  test('resets select value after emitting', async () => {
    const wrapper = mount(PuzzleSelect);
    const select = wrapper.find('#puzzle-select');
    await select.setValue(PUZZLES[0].id);
    expect((select.element as HTMLSelectElement).value).toBe('');
  });

  test('displays correct labels for black and white puzzles', () => {
    const wrapper = mount(PuzzleSelect);
    const options = wrapper.findAll('option');
    // First real option is black-3-3
    expect(options[1].text()).toBe('Black (3,3)');
    // Find a white puzzle option
    const whiteIndex = PUZZLES.findIndex((p) => p.toMove === 2);
    expect(options[whiteIndex + 1].text()).toContain('White');
  });

  test('does not emit when puzzle id is not found', async () => {
    const wrapper = mount(PuzzleSelect);
    const select = wrapper.find('#puzzle-select');
    const el = select.element as HTMLSelectElement;
    // Directly set the value to an unknown ID and trigger the change handler
    Object.defineProperty(el, 'value', { value: 'nonexistent', writable: true });
    await select.trigger('change');
    expect(wrapper.emitted('loadPuzzle')).toBeUndefined();
  });
});
