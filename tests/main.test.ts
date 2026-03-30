import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockMount = vi.fn();
const mockApp = {
  mount: mockMount,
};

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    createApp: vi.fn(() => mockApp),
  };
});

vi.mock('../src/App.vue', () => ({
  default: { name: 'App', render: () => null },
}));

describe('main.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const el = document.createElement('div');
    el.id = 'app';
    document.body.appendChild(el);
  });

  test('creates and mounts the Vue app', async () => {
    await import('../src/main');
    const { createApp } = await import('vue');

    expect(createApp).toHaveBeenCalled();
    expect(mockMount).toHaveBeenCalledWith('#app');
  });
});
