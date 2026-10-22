import { apiClient } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { instanceStore } from '../../common/storage/InstanceStore';
import { QaTaskClient } from './QaTaskClient';

export function createQaTaskConnection(): QaTaskClient | undefined {
  const capabilities = activeInstance.capabilities;
  if (!capabilities?.features.ragTasks?.supported) return undefined;
  const namespace = activeInstance.namespace;
  return new QaTaskClient(apiClient, {
    read: () => instanceStore.readQaPending(namespace),
    write: (raw: string) => instanceStore.writeQaPending(namespace, raw),
    readLegacy: () => instanceStore.readLegacyQaPending(namespace),
    clearLegacy: () => instanceStore.clearLegacyQaPending(namespace)
  }, capabilities.instanceId);
}
