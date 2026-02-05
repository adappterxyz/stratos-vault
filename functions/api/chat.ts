import { Env, handleCors, jsonResponse, errorResponse, requireAuth } from '../_lib/utils';

interface ChatRequest {
  message: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  const webhookUrl = context.env.CHAT_AGENT_WEBHOOK_URL;
  if (!webhookUrl) {
    return errorResponse('Chat agent not configured', 503);
  }

  // Require authentication
  const authResult = await requireAuth(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await context.request.json() as ChatRequest;

    if (!body.message || typeof body.message !== 'string') {
      return errorResponse('Message is required', 400);
    }

    // Use the authenticated user's ID as sessionId for perpetual conversation per user
    const payload = {
      message: body.message,
      sessionId: authResult.user.id,
      name: authResult.user.displayName || authResult.user.username,
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[Chat Agent] Webhook error:', response.status, text);
      return errorResponse('Chat agent request failed', 502);
    }

    const data = await response.json();
    return jsonResponse({ success: true, data });
  } catch (error) {
    console.error('[Chat Agent] Error:', error);
    return errorResponse('Failed to process chat request', 500);
  }
};

export const onRequestOptions: PagesFunction<Env> = async (context) => {
  return handleCors(context.request) || new Response(null, { status: 204 });
};
