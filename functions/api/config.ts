import { jsonResponse, handleCors, Env } from '../_lib/utils';

interface DockApp {
  id: string;
  name: string;
  icon: string;
  color: string;
  url: string | null;
}

// Public config endpoint - no auth required
// Returns theme, org name, dock apps, and allowed iframe origins
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Parse dock apps from JSON string
  let dockApps: DockApp[] = [];
  try {
    if (context.env.DOCK_APPS) {
      dockApps = JSON.parse(context.env.DOCK_APPS);
    }
  } catch (e) {
    console.error('Failed to parse DOCK_APPS:', e);
  }

  // Parse allowed iframe origins from comma-separated string
  let allowedIframeOrigins: string[] = [];
  if (context.env.ALLOWED_IFRAME_ORIGINS) {
    allowedIframeOrigins = context.env.ALLOWED_IFRAME_ORIGINS.split(',').map(s => s.trim());
  }

  return jsonResponse({
    success: true,
    data: {
      theme: context.env.THEME || 'purple',
      orgName: context.env.ORG_NAME || 'Canton Wallet',
      dockApps,
      allowedIframeOrigins
    }
  });
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
