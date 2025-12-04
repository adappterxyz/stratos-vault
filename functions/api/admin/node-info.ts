import { jsonResponse, handleCors, requireAdmin, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  const authResult = await requireAdmin(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  return jsonResponse({
    success: true,
    data: {
      host: context.env.SPLICE_HOST,
      port: context.env.SPLICE_PORT,
      jsonHost: context.env.CANTON_JSON_HOST,
      jsonPort: context.env.CANTON_JSON_PORT
    }
  });
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
