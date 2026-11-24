const shim = new URL('./pg-shim.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === 'pg') return { url: shim, shortCircuit: true };
  return next(specifier, context);
}
