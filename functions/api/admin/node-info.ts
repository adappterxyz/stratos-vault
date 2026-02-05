import { jsonResponse, handleCors, requireAdmin, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  const authResult = await requireAdmin(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  // Fetch Canton version from JSON API
  let cantonVersion: string | null = null;
  try {
    const jsonHost = context.env.CANTON_JSON_HOST || context.env.SPLICE_HOST || 'localhost';
    const jsonPort = parseInt(context.env.CANTON_JSON_PORT || '443');
    const protocol = jsonPort === 443 ? 'https' : 'http';
    const port = jsonPort === 443 ? '' : `:${jsonPort}`;
    const versionRes = await fetch(`${protocol}://${jsonHost}${port}/v2/version`);
    if (versionRes.ok) {
      const versionData = await versionRes.json() as { version?: string };
      cantonVersion = versionData.version || null;
    }
  } catch {
    // Version fetch failed, continue without it
  }

  return jsonResponse({
    success: true,
    data: {
      host: context.env.SPLICE_HOST,
      port: context.env.SPLICE_PORT,
      jsonHost: context.env.CANTON_JSON_HOST,
      jsonPort: context.env.CANTON_JSON_PORT,
      cantonVersion
    }
  });
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
