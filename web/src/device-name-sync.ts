import { browserPushEnabled, currentDeviceSlot, matchesCurrentDevice } from './browser-push';
import { deviceNameVariable, suggestDeviceName, validDeviceName } from './device-names';
import { createVariableIfAbsent, listSecrets, readVariable } from './github';

/** Only the device whose current subscription is verified may suggest a shared name. */
export async function syncCurrentDeviceName(repo: string, token: string): Promise<string | null> {
  if (!await browserPushEnabled()) return null;
  const slot = currentDeviceSlot();
  if (!slot) return null;
  const secrets = await listSecrets(repo, token);
  if (!matchesCurrentDevice(slot, secrets[slot])) return null;
  const variable = deviceNameVariable(slot);
  const existing = await readVariable(repo, token, variable);
  if (existing !== null) return validDeviceName(existing) ? existing.trim() : null;
  const suggestion = await suggestDeviceName();
  const latest = await listSecrets(repo, token);
  if (!await browserPushEnabled() || currentDeviceSlot() !== slot || !matchesCurrentDevice(slot, latest[slot])) return null;
  if (await createVariableIfAbsent(repo, token, variable, suggestion)) return suggestion;
  const winner = await readVariable(repo, token, variable);
  return winner && validDeviceName(winner) ? winner.trim() : null;
}
