/** Rebind both live instances and spawn templates before disposing a GPU-only environment. */
export function rebindEnvironment(root, previous, next) {
  root?.traverse(object => {
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      if (previous && material.envMap === previous) material.envMap = next;
      material.needsUpdate = true;
    }
  });
}
