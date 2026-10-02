/**
 * Cloudflare Pages Function: proxies every /api/* request to the CommonHours API
 * (set API_ORIGIN in the Pages project, e.g. https://commonhours-api.onrender.com).
 * Keeping the API same-origin means the web app needs no CORS or build-time API URL.
 */
interface Env {
  API_ORIGIN: string;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (!env.API_ORIGIN) {
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'API_ORIGIN is not configured on the Pages project.', module: 'web-proxy' } },
      { status: 500 },
    );
  }
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);
  return fetch(new Request(target.toString(), request));
};
