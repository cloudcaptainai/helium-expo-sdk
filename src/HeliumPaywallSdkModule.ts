import { NativeModule, requireNativeModule } from "expo";

import {
  HeliumDownloadStatus,
  HeliumPaywallSdkModuleEvents,
  HeliumTransactionStatus,
  NativeHeliumConfig,
} from "./HeliumPaywallSdk.types";

interface PaywallInfoResult {
  errorMsg?: string;
  templateName?: string;
  shouldShow?: boolean;
}

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

  handlePurchaseResult(
    statusString: HeliumTransactionStatus,
    errorMsg?: string,
  ): void;

  handleRestoreResult(success: boolean): void;

  getPaywallInfo(trigger: string): PaywallInfoResult;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<HeliumPaywallSdkModule>("HeliumPaywallSdk");
