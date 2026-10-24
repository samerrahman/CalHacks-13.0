import { queryGeneric, mutationGeneric, internalMutationGeneric, actionGeneric, type DataModelFromSchemaDefinition, type QueryBuilder, type MutationBuilder, type ActionBuilder } from 'convex/server';
import schema from './schema';
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export const query = queryGeneric as QueryBuilder<DataModel, 'public'>;
export const mutation = mutationGeneric as MutationBuilder<DataModel, 'public'>;
export const internalMutation = internalMutationGeneric as MutationBuilder<DataModel, 'internal'>;
export const action = actionGeneric as ActionBuilder<DataModel, 'public'>;
