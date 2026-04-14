import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import BoardGrid from '../../src/components/BoardGrid.vue';
import { BLACK, WHITE, EMPTY } from '../../src/engine';

describe('BoardGrid', () => {
  function createBoard(size: number): Uint8Array {
    return new Uint8Array(size * size);
  }

  test('renders the correct number of cells for a 9x9 board', () => {
    const wrapper = mount(BoardGrid, {
      props: {
        board: createBoard(9),
        size: 9,
        disabled: false,
        boardVersion: 0,
      },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBe(81);
  });

  test('renders black and white stones with correct classes', () => {
    const board = createBoard(9);
    board[0] = BLACK;
    board[1] = WHITE;

    const wrapper = mount(BoardGrid, {
      props: { board, size: 9, disabled: false, boardVersion: 0 },
    });

    const buttons = wrapper.findAll('button');
    expect(buttons[0].classes()).toContain('stone-black');
    expect(buttons[0].text()).toBe('●');
    expect(buttons[1].classes()).toContain('stone-white');
    expect(buttons[1].text()).toBe('●');
    expect(buttons[2].classes()).not.toContain('stone-black');
    expect(buttons[2].classes()).not.toContain('stone-white');
    expect(buttons[2].text()).toBe('');
  });

  test('disables buttons with stones on them', () => {
    const board = createBoard(9);
    board[0] = BLACK;

    const wrapper = mount(BoardGrid, {
      props: { board, size: 9, disabled: false, boardVersion: 0 },
    });

    const buttons = wrapper.findAll('button');
    expect(buttons[0].attributes('disabled')).toBeDefined();
    expect(buttons[1].attributes('disabled')).toBeUndefined();
  });

  test('disables all buttons when disabled prop is true', () => {
    const wrapper = mount(BoardGrid, {
      props: { board: createBoard(9), size: 9, disabled: true, boardVersion: 0 },
    });

    const buttons = wrapper.findAll('button');
    for (const button of buttons) {
      expect(button.attributes('disabled')).toBeDefined();
    }
  });

  test('emits cellClick with index when a cell is clicked', async () => {
    const wrapper = mount(BoardGrid, {
      props: { board: createBoard(9), size: 9, disabled: false, boardVersion: 0 },
    });

    await wrapper.findAll('button')[5].trigger('click');
    expect(wrapper.emitted('cellClick')).toBeTruthy();
    expect(wrapper.emitted('cellClick')![0]).toEqual([5]);
  });

  test('sets grid template columns style based on size', () => {
    const wrapper = mount(BoardGrid, {
      props: { board: createBoard(9), size: 9, disabled: false, boardVersion: 0 },
    });

    const board = wrapper.find('.board');
    expect(board.attributes('style')).toContain('grid-template-columns: repeat(9, 36px)');
  });

  test('has correct aria-label', () => {
    const wrapper = mount(BoardGrid, {
      props: { board: createBoard(9), size: 9, disabled: false, boardVersion: 0 },
    });

    const board = wrapper.find('.board');
    expect(board.attributes('aria-label')).toBe('GoGomoku board');
  });

  test('recomputes cells when boardVersion changes', async () => {
    const board = createBoard(9);
    const wrapper = mount(BoardGrid, {
      props: { board, size: 9, disabled: false, boardVersion: 0 },
    });

    // Initially empty
    let buttons = wrapper.findAll('button');
    expect(buttons[0].classes()).not.toContain('stone-black');

    // Mutate the board in place (same Uint8Array instance)
    board[0] = BLACK;
    // Without boardVersion change, Vue would not recompute
    await wrapper.setProps({ boardVersion: 1 });

    buttons = wrapper.findAll('button');
    expect(buttons[0].classes()).toContain('stone-black');
    expect(buttons[0].text()).toBe('●');
  });

  test('shows board-evaluation heatmap title and style on empty evaluated moves', () => {
    const board = createBoard(9);
    board[0] = BLACK;
    const moveEvaluation = Array.from({ length: 81 }, () => null as { score: number; probability: number } | null);
    moveEvaluation[1] = { score: 1234, probability: 0.8 };
    const wrapper = mount(BoardGrid, {
      props: { board, size: 9, disabled: false, boardVersion: 0, moveEvaluation },
    });

    const buttons = wrapper.findAll('button');
    expect(buttons[1].attributes('title')).toContain('1234');
    expect(buttons[1].attributes('style')).toContain('--eval-probability: 0.8');
    expect(buttons[0].attributes('title')).toBeUndefined();
  });
});
