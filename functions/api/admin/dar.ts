import { CantonJsonClient } from '../../_lib/canton-json-client';
import { validateAdminToken, validateSuperadminSession } from '../../_lib/utils';

interface Env {
  DB: D1Database;
  CANTON_JSON_HOST: string;
  CANTON_JSON_PORT: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_USER: string;
  CANTON_AUTH_AUDIENCE: string;
}

// Helper to validate either admin or superadmin token
async function validateAuth(db: D1Database, request: Request): Promise<boolean> {
  const adminToken = request.headers.get('X-Admin-Token');
  if (adminToken && await validateAdminToken(db, adminToken)) {
    return true;
  }

  const superadminToken = request.headers.get('X-Superadmin-Token');
  if (superadminToken) {
    const user = await validateSuperadminSession(db, superadminToken);
    if (user) return true;
  }

  return false;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Verify admin or superadmin authentication
  if (!await validateAuth(env.DB, request)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Get content type to determine if this is form data, JSON, or raw binary
    const contentType = request.headers.get('Content-Type') || '';

    let darBytes: ArrayBuffer;
    let darName: string;

    if (contentType.includes('application/json')) {
      // Handle URL-based installation
      const body = await request.json() as { darUrl?: string };

      if (!body.darUrl) {
        return new Response(JSON.stringify({ success: false, error: 'No darUrl provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Validate URL format
      let darEndpoint: string;
      try {
        const parsed = new URL(body.darUrl);
        darEndpoint = parsed.href;
      } catch {
        return new Response(JSON.stringify({ success: false, error: 'Invalid URL format' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Fetch the DAR from the remote URL
      console.log(`Fetching DAR from: ${darEndpoint}`);
      const darResponse = await fetch(darEndpoint);

      if (!darResponse.ok) {
        return new Response(JSON.stringify({
          success: false,
          error: `Failed to fetch DAR from ${darEndpoint}: ${darResponse.status} ${darResponse.statusText}`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      darBytes = await darResponse.arrayBuffer();
      // Try to get filename from Content-Disposition header, or derive from URL
      const disposition = darResponse.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";\s]+)"?/);
        darName = match ? match[1] : 'remote.dar';
      } else {
        // Use URL path as the name
        const parsed = new URL(body.darUrl);
        const pathParts = parsed.pathname.split('/');
        darName = pathParts[pathParts.length - 1] || 'remote.dar';
      }
    } else if (contentType.includes('multipart/form-data')) {
      // Handle form data upload
      const formData = await request.formData();
      const file = formData.get('dar') as File | null;

      if (!file) {
        return new Response(JSON.stringify({ success: false, error: 'No DAR file provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      darBytes = await file.arrayBuffer();
      darName = file.name || 'uploaded.dar';
    } else {
      // Handle raw binary upload
      darBytes = await request.arrayBuffer();
      darName = request.headers.get('X-Dar-Name') || 'uploaded.dar';
    }

    if (darBytes.byteLength === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Empty DAR file' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Initialize Canton client
    const cantonClient = new CantonJsonClient({
      host: env.CANTON_JSON_HOST,
      port: parseInt(env.CANTON_JSON_PORT) || 443,
      authSecret: env.CANTON_AUTH_SECRET,
      authUser: env.CANTON_AUTH_USER,
      authAudience: env.CANTON_AUTH_AUDIENCE
    });

    // Upload the DAR
    const result = await cantonClient.uploadDar(darBytes, darName);

    return new Response(JSON.stringify({
      success: true,
      data: {
        mainPackageId: result.mainPackageId,
        darName,
        size: darBytes.byteLength
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('DAR upload error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'DAR upload failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// GET endpoint to list packages
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Verify admin or superadmin authentication
  if (!await validateAuth(env.DB, request)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const cantonClient = new CantonJsonClient({
      host: env.CANTON_JSON_HOST,
      port: parseInt(env.CANTON_JSON_PORT) || 443,
      authSecret: env.CANTON_AUTH_SECRET,
      authUser: env.CANTON_AUTH_USER,
      authAudience: env.CANTON_AUTH_AUDIENCE
    });

    const packageIds = await cantonClient.listPackages();

    return new Response(JSON.stringify({
      success: true,
      data: { packageIds }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('List packages error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list packages'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
