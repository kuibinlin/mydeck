// Route table matching.
//
// Routes are declared as [method, pattern, handler]. Patterns use :param
// placeholders; all current params are numeric ids, so the compiled pattern
// both matches and validates them.
//
// Matching on method as well as path means an unsupported method on a known
// path is a clean 404 rather than a handler falling through and returning
// undefined, which crashes the runtime.

function compile(pattern) {
  const names = [];
  const source = pattern.replace(/:([A-Za-z]+)/g, (_, name) => {
    names.push(name);
    return "(\\d+)";
  });
  return { regex: new RegExp(`^${source}$`), names };
}

export function createRouter(routes) {
  const compiled = routes.map(([method, pattern, handler]) => ({
    method,
    handler,
    ...compile(pattern),
  }));

  return function match(method, path) {
    for (const route of compiled) {
      if (route.method !== method) continue;
      const found = path.match(route.regex);
      if (!found) continue;
      const params = {};
      route.names.forEach((name, i) => {
        params[name] = parseInt(found[i + 1], 10);
      });
      return { handler: route.handler, params };
    }
    return null;
  };
}
