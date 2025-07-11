// Reexport the native module. On web, it will be resolved to HeliumPaywallSdkModule.web.ts
// and on native platforms to HeliumPaywallSdkModule.ts
import {HeliumPaywallEvent} from "./HeliumPaywallSdk.types";
import HeliumPaywallSdkModule from "./HeliumPaywallSdkModule";
import { EventSubscription } from 'expo-modules-core';

export { default } from './HeliumPaywallSdkModule';
// export { default as HeliumPaywallSdkView } from './HeliumPaywallSdkView';
export * from  './HeliumPaywallSdk.types';

export function addHeliumPaywallEventListener(listener: (event: HeliumPaywallEvent) => void): EventSubscription {
  return HeliumPaywallSdkModule.addListener('onHeliumPaywallEvent', listener);
}
