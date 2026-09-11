import { createHash } from 'node:crypto';

import type Redis from 'ioredis';

type RedisLuaClient = Pick<Redis, 'defineCommand'>;

const commandNamesByScript = new WeakMap<object, Map<string, string>>();
const commandPrefixes = new WeakMap<object, string>();
let nextClientId = 0;

/**
 * Registers a Lua source once per Redis connection, then invokes its named
 * ioredis command. ioredis transparently uses EVALSHA after registration.
 */
export function runRedisLuaCommand<Result>(
  redis: RedisLuaClient,
  lua: string,
  numberOfKeys: number,
  ...args: Array<string | number>
): Promise<Result> {
  const scriptHash = createHash('sha256').update(lua).digest('hex').slice(0, 16);
  const commandNames = commandNamesByScript.get(redis) ?? new Map<string, string>();
  commandNamesByScript.set(redis, commandNames);

  const commandPrefix = commandPrefixes.get(redis) ?? `withaiGameSession${nextClientId++}`;
  commandPrefixes.set(redis, commandPrefix);
  const commandName = commandNames.get(scriptHash) ?? `${commandPrefix}${scriptHash}`;
  if (!commandNames.has(scriptHash)) {
    redis.defineCommand(commandName, { lua, numberOfKeys });
    commandNames.set(scriptHash, commandName);
  }

  const command = Reflect.get(redis, commandName);
  if (typeof command !== 'function') {
    return Promise.reject(new Error(`Redis Lua command ${commandName} was not registered.`));
  }
  return command.apply(redis, args);
}
