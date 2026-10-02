/** Production checks each linked program once; detailed logs are read on failure. */
export class ShaderProgramValidator {
  constructor() { this.validated = new WeakSet(); this.checkedCount = 0; }
  validate(renderer) {
    const gl = renderer.getContext();
    // Device loss has its own recovery path and must not be cached as a shader failure.
    if (gl.isContextLost()) return;
    for (const program of renderer.info.programs || []) {
      if (this.validated.has(program)) continue;
      if (gl.getProgramParameter(program.program, gl.LINK_STATUS) !== true) {
        const log = gl.getProgramInfoLog(program.program) || 'No program diagnostic available';
        throw new Error(`Shader program did not link: ${log}`);
      }
      this.validated.add(program); this.checkedCount++;
    }
  }
}
