import { SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import type hush from './index';

export type HushDb = typeof hush;
export type HushCtx = ReducerCtx<InferSchema<HushDb>>;

/** Same capability rule as the session reducers: 64 lowercase hex characters. */
export const capability = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

/** The live session for an owner capability, or a generic refusal that reveals nothing. */
export function ownedSession(ctx: HushCtx, id: string, ownerCapability: string) {
  const row = ctx.db.session.id.find(id);
  if (!row || !capability(ownerCapability) || row.ownerCapability !== ownerCapability || row.expiresAtMs < ctx.timestamp.toMillis()) throw new SenderError('Session unavailable');
  return row;
}
