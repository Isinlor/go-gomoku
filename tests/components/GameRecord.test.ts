import { describe, test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GameRecord from '../../src/components/GameRecord.vue';

describe('GameRecord', () => {
  test('renders the game record in a readonly textarea', () => {
    const wrapper = mount(GameRecord, {
      props: { record: 'B9 e5 d4' },
    });

    const textarea = wrapper.find('textarea');
    expect(textarea.exists()).toBe(true);
    expect(textarea.attributes('readonly')).toBeDefined();
    expect((textarea.element as HTMLTextAreaElement).value).toBe('B9 e5 d4');
  });

  test('renders the Copy URL button', () => {
    const wrapper = mount(GameRecord, {
      props: { record: 'B9' },
    });

    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('Copy URL');
  });

  test('emits copyUrl when Copy URL button is clicked', async () => {
    const wrapper = mount(GameRecord, {
      props: { record: 'B9' },
    });

    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('copyUrl')).toBeTruthy();
  });

  test('has correct aria-label on textarea', () => {
    const wrapper = mount(GameRecord, {
      props: { record: 'B9' },
    });

    const textarea = wrapper.find('textarea');
    expect(textarea.attributes('aria-label')).toBe('Game record in move notation');
  });
});
