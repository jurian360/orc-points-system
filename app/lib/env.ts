// Required-environment-variable access.
//
// Values are read lazily, inside functions, rather than at module scope. The
// Dockerfile builds without any secrets present (see COOLIFY.md), so throwing
// at import time would break `next build`. Reading on first use still fails
// fast — on the first request that needs the value — but keeps the build green.

export function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is not set. Configure it in the deployment environment ` +
        `(Coolify -> Environment Variables) before starting the app.`
    );
  }

  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters long.`);
  }

  return value;
}
