export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier)) {
      return next(specifier + ".js", context);
    }
    throw e;
  }
}
