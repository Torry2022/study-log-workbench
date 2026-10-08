import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { activeInstance } from '../network/InstanceConfig';

const encoder: util.TextEncoder = new util.TextEncoder();
const decoder: util.TextDecoder = new util.TextDecoder('utf-8');

function alias(): string {
  if (!activeInstance.namespace) throw new Error('请先连接服务器');
  return 'public-token-' + activeInstance.namespace;
}

function bytes(value: string): Uint8Array { return encoder.encodeInto(value); }

export class TokenStore {
  static async read(): Promise<string> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, bytes(alias()));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const result: asset.AssetMap[] = await asset.query(query);
      const secret = result.length ? result[0].get(asset.Tag.SECRET) : undefined;
      return secret instanceof Uint8Array ? decoder.decodeToString(secret) : '';
    } catch (_) { return ''; }
  }

  static async write(token: string): Promise<void> {
    const tokenAlias = alias();
    const revision = activeInstance.revision;
    await TokenStore.clear();
    if (revision !== activeInstance.revision) throw new Error('服务器连接已切换');
    const attributes: asset.AssetMap = new Map();
    attributes.set(asset.Tag.ALIAS, bytes(tokenAlias));
    attributes.set(asset.Tag.SECRET, bytes(token));
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    await asset.add(attributes);
  }

  static async clear(): Promise<void> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, bytes(alias()));
    try { await asset.remove(query); }
    catch (_) { /* Removing a missing token is idempotent. */ }
  }
}
