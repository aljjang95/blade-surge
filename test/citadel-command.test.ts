import { expect, test } from 'bun:test';
import { CITADEL_COMMAND_COLLAPSED_KEY, readCitadelCommandCollapsed, writeCitadelCommandCollapsed } from '../src/ui/citadel-command.js';

test('citadel command collapse state round trips through storage', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as unknown as Storage;
  expect(readCitadelCommandCollapsed(storage)).toBe(false);
  writeCitadelCommandCollapsed(true, storage);
  expect(values.get(CITADEL_COMMAND_COLLAPSED_KEY)).toBe('true');
  expect(readCitadelCommandCollapsed(storage)).toBe(true);
  writeCitadelCommandCollapsed(false, storage);
  expect(readCitadelCommandCollapsed(storage)).toBe(false);
});

test('citadel command storage failures fall back safely', () => {
  const storage = { getItem: () => { throw new Error('storage unavailable'); }, setItem: () => { throw new Error('storage unavailable'); } } as unknown as Storage;
  expect(readCitadelCommandCollapsed(storage)).toBe(false);
  expect(() => writeCitadelCommandCollapsed(true, storage)).not.toThrow();
});
