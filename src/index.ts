
import {HeliumPaywallEvent} from "./HeliumPaywallSdk.types";
import HeliumPaywallSdkModule from "./HeliumPaywallSdkModule";
import { EventSubscription } from 'expo-modules-core';

export { default } from './HeliumPaywallSdkModule';
// export { default as HeliumPaywallSdkView } from './HeliumPaywallSdkView';
export * from  './HeliumPaywallSdk.types';

export function addHeliumPaywallEventListener(listener: (event: HeliumPaywallEvent) => void): EventSubscription {
  return HeliumPaywallSdkModule.addListener('onHeliumPaywallEvent', listener);
}

export const initialize = HeliumPaywallSdkModule.initialize;
export const presentUpsell = (triggerName: string, onFallback?: () => void) => {
  // todo check HeliumBridge.getFetchedTriggerNames((triggerNames: string[]) ??
  const downloadStatus = getDownloadStatus();
  if (downloadStatus !== 'downloadSuccess') {
    console.log(
      `Helium trigger "${triggerName}" not found or download status not successful. Status:`,
      downloadStatus
    );
    onFallback?.();
    HeliumPaywallSdkModule.fallbackOpenOrCloseEvent(triggerName, true, 'presented');
    return;
  }

  try {
    HeliumPaywallSdkModule.presentUpsell(triggerName);
  } catch (error) {
    console.log('Helium present error', error);
    onFallback?.();
    HeliumPaywallSdkModule.fallbackOpenOrCloseEvent(triggerName, true, 'presented');
  }

};
export const hideUpsell = HeliumPaywallSdkModule.hideUpsell;
export const hideAllUpsells = HeliumPaywallSdkModule.hideAllUpsells;
export const getDownloadStatus = HeliumPaywallSdkModule.getDownloadStatus;

export {createCustomPurchaseConfig} from './HeliumPaywallSdk.types';

export type {
  HeliumTransactionStatus,
  HeliumConfig,
  HELIUM_CTA_NAMES
} from './HeliumPaywallSdk.types';
