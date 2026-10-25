import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, authorizeOwnerDeletion, hashCapability } from '../convex/auth';

test('expired trace stays unreadable/unwritable while only its owner can delete it', async () => {
 const owner = 'a'.repeat(64), judge = 'b'.repeat(64), stranger = 'c'.repeat(64);
 const record = { ownerHash: await hashCapability(owner), judgeHash: await hashCapability(judge), consent: true, expiresAt: Date.now() - 1 };
 let stored: typeof record | null = record;
 const ctx = { db: { get: async () => stored } } as unknown as Parameters<typeof authorize>[0];
 const id = 'test-session' as Parameters<typeof authorize>[1];
 // All ordinary owner operations (append/provider claims) and judge reads
 // remain behind the unchanged expiration gate.
 await assert.rejects(authorize(ctx, id, owner));
 await assert.rejects(authorize(ctx, id, judge, true));
 assert.equal(await authorizeOwnerDeletion(ctx, id, owner), record);
 await assert.rejects(authorizeOwnerDeletion(ctx, id, judge));
 await assert.rejects(authorizeOwnerDeletion(ctx, id, stranger));
 await assert.rejects(authorizeOwnerDeletion(ctx, id, 'malformed'));
 record.consent = false;
 assert.equal(await authorizeOwnerDeletion(ctx, id, owner), record, 'revoked sharing must still permit owner erasure');
 await assert.rejects(authorize(ctx, id, judge, true));
 stored = null;
 await assert.rejects(authorizeOwnerDeletion(ctx, id, owner));
});
