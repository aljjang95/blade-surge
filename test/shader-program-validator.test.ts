import { expect, test } from 'bun:test';
import { ShaderProgramValidator } from '../src/engine/shader-program-validator.js';

function fixture() {
  const programs: any[] = [], states = new Map<object, boolean>(), queries: object[] = [];
  let lost = false, logReads = 0;
  const gl = { LINK_STATUS: 0x8b82, isContextLost: () => lost,
    getProgramParameter: (program: object, parameter: number) => {
      expect(parameter).toBe(gl.LINK_STATUS); queries.push(program); return states.get(program);
    }, getProgramInfoLog: () => { logReads++; return 'synthetic link failure'; } };
  return { renderer: { getContext: () => gl, info: { programs } }, states, queries,
    setLost: (value: boolean) => { lost = value; }, getLogReads: () => logReads };
}

test('linked programs are checked once without reading success logs; replacement handles are checked', () => {
  const f = fixture(), validator = new ShaderProgramValidator(), first = { program: {} };
  f.renderer.info.programs.push(first); f.states.set(first.program, true);
  for (let frame = 0; frame < 120; frame++) validator.validate(f.renderer);
  expect(f.queries).toHaveLength(1); expect(f.getLogReads()).toBe(0);
  const replacement = { program: {} };
  f.renderer.info.programs[0] = replacement; f.states.set(replacement.program, true);
  validator.validate(f.renderer); expect(f.queries).toHaveLength(2); expect(validator.checkedCount).toBe(2);
});

test('failed links still throw the diagnostic and cannot be cached as valid', () => {
  const f = fixture(), validator = new ShaderProgramValidator(), failed = { program: {} };
  f.renderer.info.programs.push(failed); f.states.set(failed.program, false);
  expect(() => validator.validate(f.renderer)).toThrow('synthetic link failure');
  expect(validator.checkedCount).toBe(0); expect(f.getLogReads()).toBe(1);
  f.states.set(failed.program, true); validator.validate(f.renderer);
  expect(validator.checkedCount).toBe(1); expect(f.queries).toHaveLength(2);
});

test('context loss defers checks; restored new programs are validated normally', () => {
  const f = fixture(), validator = new ShaderProgramValidator(), program = { program: {} };
  f.renderer.info.programs.push(program); f.states.set(program.program, true); f.setLost(true);
  validator.validate(f.renderer); expect(f.queries).toHaveLength(0); expect(validator.checkedCount).toBe(0);
  f.setLost(false); validator.validate(f.renderer); expect(f.queries).toHaveLength(1);
});
