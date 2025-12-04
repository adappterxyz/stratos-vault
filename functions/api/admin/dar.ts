import { CantonJsonClient } from '../../_lib/canton-json-client';
import { validateAdminToken } from '../../_lib/utils';

interface Env {
  DB: D1Database;
  CANTON_JSON_HOST: string;
  CANTON_JSON_PORT: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_USER: string;
  CANTON_AUTH_AUDIENCE: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Verify admin authentication
  const adminToken = request.headers.get('X-Admin-Token');
  if (!await validateAdminToken(env.DB, adminToken)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Get content type to determine if this is form data or raw binary
    const contentType = request.headers.get('Content-Type') || '';

    let darBytes: ArrayBuffer;
    let darName: string;

    if (contentType.includes('multipart/form-data')) {
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

  // Verify admin authentication
  const adminToken = request.headers.get('X-Admin-Token');
  if (!await validateAdminToken(env.DB, adminToken)) {
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
