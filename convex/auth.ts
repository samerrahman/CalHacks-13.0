import type { GenericQueryCtx } from 'convex/server';
import type { GenericId } from 'convex/values';
import type { DataModel } from './server';

export async function hashCapability(capability: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(capability)) throw new Error('Invalid session capability');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function authorize(ctx: GenericQueryCtx<DataModel>, sessionId: GenericId<'sessions'>, capability: string, judge = false) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.expiresAt < Date.now() || (judge && !session.consent)) throw new Error('Session unavailable');
  const hash = await hashCapability(capability);
  if (hash !== (judge ? session.judgeHash : session.ownerHash)) throw new Error('Session unavailable');
  return session;
}
