import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { activeInstance } from '../network/InstanceConfig';
import { BusinessError } from '@kit.BasicServicesKit';

const encoder: util.TextEncoder = new util.TextEncoder();
const decoder: util.TextDecoder = new util.TextDecoder('utf-8');

function alias(): string {
  if (!activeInstance.namespace) throw new Error('请先连接服务器');
  return 'public-token-' + (activeInstance.credentialId || activeInstance.namespace);
}

function bytes(value: string): Uint8Array { return encoder.encodeInto(value); }

export class TokenStore {
  static async stage(token: string): Promise<string> {
    const credentialId = util.generateRandomUUID();
    const attributes: asset.AssetMap = new Map();
    attributes.set(asset.Tag.ALIAS, bytes('public-token-' + credentialId));
    attributes.set(asset.Tag.SECRET, bytes(token));
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    try { await asset.add(attributes); }
    catch (error) {
      await TokenStore.removeCredential(credentialId);
      throw error instanceof Error ? error : new Error('无法保存连接凭据，请重试');
    }
    return credentialId;
  }

  static async removeCredential(id: string): Promise<void> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, bytes('public-token-' + id));
    try { await asset.remove(query); } catch (_) { /* Removing a missing credential is idempotent. */ }
  }

  static async removeCredentialStrict(id: string): Promise<void> {
    if (!id) throw new Error('没有可断开的工作台凭据');
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, bytes('public-token-' + id));
    try { await asset.remove(query); }
    catch (error) {
      if ((error as BusinessError).code !== asset.ErrorCode.NOT_FOUND) throw new Error('本机连接凭据移除失败，请重试；当前工作台仍保留');
    }
  }
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
