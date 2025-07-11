import { NativeModule, requireNativeModule } from "expo";

import {
  HeliumDownloadStatus,
  HeliumPaywallSdkModuleEvents,
  NativeHeliumConfig,
} from "./HeliumPaywallSdk.types";

declare class HeliumPaywallSdkModule extends NativeModule<HeliumPaywallSdkModuleEvents> {
  initialize(config: NativeHeliumConfig): void;

  presentUpsell(triggerName: string): void;

  hideUpsell(): void;

  hideAllUpsells(): void;

  getDownloadStatus(): HeliumDownloadStatus;

  fallbackOpenOrCloseEvent(
    trigger: string,
    isOpen: boolean,
    viewType: string,
  ): void;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<HeliumPaywallSdkModule>("HeliumPaywallSdk");
