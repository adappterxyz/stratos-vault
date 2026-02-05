import { jsonResponse, errorResponse, handleCors, Env, requireSuperadminPrivilege, hashPassword } from '../../../_lib/utils';

interface Context {
  request: Request;
  env: Env;
  params: { userId: string };
}

// PUT - Update a superadmin user
export async function onRequestPut(context: Context) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege to update users
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  const { userId } = context.params;

  try {
    const body = await context.request.json() as {
      displayName?: string;
      password?: string;
      isSuperadmin?: boolean;
    };

    // Check if user exists
    const existingUser = await context.env.DB.prepare(
      `SELECT * FROM superadmin_users WHERE id = ?`
    ).bind(userId).first();

    if (!existingUser) {
      return errorResponse('User not found', 404);
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (body.displayName !== undefined) {
      updates.push('display_name = ?');
      values.push(body.displayName);
    }

    if (body.password) {
      const passwordHash = await hashPassword(body.password);
      updates.push('password_hash = ?');
      values.push(passwordHash);
    }

    if (body.isSuperadmin !== undefined) {
      // Prevent removing superadmin from self if they're the only superadmin
      if (!body.isSuperadmin && userId === authResult.user.id) {
        const superadminCount = await context.env.DB.prepare(
          `SELECT COUNT(*) as count FROM superadmin_users WHERE is_superadmin = 1`
        ).first();
        if ((superadminCount?.count as number) <= 1) {
          return errorResponse('Cannot remove superadmin privilege from the only superadmin', 400);
        }
      }
      updates.push('is_superadmin = ?');
      values.push(body.isSuperadmin ? 1 : 0);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update', 400);
    }

    updates.push('updated_at = datetime("now")');
    values.push(userId);

    await context.env.DB.prepare(
      `UPDATE superadmin_users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    // Fetch updated user
    const updatedUser = await context.env.DB.prepare(
      `SELECT id, username, display_name, is_superadmin FROM superadmin_users WHERE id = ?`
    ).bind(userId).first();

    return jsonResponse({
      success: true,
      data: {
        id: updatedUser?.id,
        username: updatedUser?.username,
        displayName: updatedUser?.display_name,
        isSuperadmin: (updatedUser?.is_superadmin as number) === 1
      }
    });
  } catch (error) {
    console.error('Update superadmin user error:', error);
    return errorResponse('Failed to update user');
  }
}

// DELETE - Delete a superadmin user
export async function onRequestDelete(context: Context) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege to delete users
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  const { userId } = context.params;

  try {
    // Prevent self-deletion
    if (userId === authResult.user.id) {
      return errorResponse('Cannot delete your own account', 400);
    }

    // Check if user exists
    const existingUser = await context.env.DB.prepare(
      `SELECT * FROM superadmin_users WHERE id = ?`
    ).bind(userId).first();

    if (!existingUser) {
      return errorResponse('User not found', 404);
    }

    // Delete user (sessions will cascade)
    await context.env.DB.prepare(
      `DELETE FROM superadmin_users WHERE id = ?`
    ).bind(userId).run();

    return jsonResponse({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete superadmin user error:', error);
    return errorResponse('Failed to delete user');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
