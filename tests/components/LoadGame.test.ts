import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import LoadGame from '../../src/components/LoadGame.vue';

describe('LoadGame', () => {
  test('renders the load input and button', () => {
    const wrapper = mount(LoadGame, {
      props: { error: '' },
    });

    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.find('button').exists()).toBe(true);
    expect(wrapper.find('button').text()).toBe('Load game');
  });

  test('emits loadGame with textarea content when button is clicked', async () => {
    const wrapper = mount(LoadGame, {
      props: { error: '' },
    });

    const textarea = wrapper.find('textarea');
    await textarea.setValue('B9 e5 d4');
    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('loadGame')).toBeTruthy();
    expect(wrapper.emitted('loadGame')![0]).toEqual(['B9 e5 d4']);
  });

  test('displays error message when error prop is set', () => {
    const wrapper = mount(LoadGame, {
      props: { error: 'Invalid board size token: B10' },
    });

    const errorSpan = wrapper.find('#load-error');
    expect(errorSpan.text()).toBe('Invalid board size token: B10');
  });

  test('displays no error when error prop is empty', () => {
    const wrapper = mount(LoadGame, {
      props: { error: '' },
    });

    const errorSpan = wrapper.find('#load-error');
    expect(errorSpan.text()).toBe('');
  });

  test('textarea has correct placeholder', () => {
    const wrapper = mount(LoadGame, {
      props: { error: '' },
    });

    const textarea = wrapper.find('textarea');
    expect(textarea.attributes('placeholder')).toBe('e.g. B9 e5 d4 f4 ...');
  });
});
