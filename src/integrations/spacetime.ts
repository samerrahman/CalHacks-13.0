import { DbConnection } from '../module_bindings';

const nodeEnv = typeof process === 'undefined' ? undefined : process.env;
export const spacetimeConfig = {
  uri: import.meta.env?.VITE_SPACETIMEDB_HOST || nodeEnv?.VITE_SPACETIMEDB_HOST || 'wss://maincloud.spacetimedb.com',
  database: import.meta.env?.VITE_SPACETIMEDB_DB_NAME || nodeEnv?.VITE_SPACETIMEDB_DB_NAME || '',
};

/** Create an isolated connection. The database name is public configuration. */
export function connectSpacetime(onDisconnect?: () => void, onReconnect?: () => void): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const conn = DbConnection.builder()
      .withUri(spacetimeConfig.uri)
      .withDatabaseName(spacetimeConfig.database)
      .withAutomaticReconnect()
      .onConnect(connection => { if (!settled) { settled = true; clearTimeout(timer); resolve(connection); } else onReconnect?.(); })
      .onConnectError((_ctx, error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } })
      .onDisconnect(() => onDisconnect?.())
      .build();
    timer = setTimeout(() => { if (!settled) { settled = true; conn.disconnect(); reject(new Error('SpacetimeDB connection timed out')); } }, 6000);
  });
}

export function judgeQuery(id: string, capability: string): string {
  return capabilityQuery('judge_trace', id, capability);
}
/** Every read view takes the session id and judge capability; both are validated hex. */
export function capabilityQuery(view: 'judge_trace' | 'spectator_vitals_feed' | 'physics_feed', id: string, capability: string): string {
  if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(capability)) throw new Error('Invalid judge access');
  return `SELECT * FROM ${view}('${id}', '${capability}')`;
}
