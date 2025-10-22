import { NativeModule, requireNativeModule } from "expo";

import { ExperimentInfo } from "./HeliumExperimentInfo.types";
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

interface ExperimentInfoResult {
  errorMsg?: string;
  experimentInfo?: ExperimentInfo;
}

declare class HeliumPaywallSdkModule extends NativeModule<HeliumPaywallSdkModuleEvents> {
  initialize(config: NativeHeliumConfig): void;

  presentUpsell(
    triggerName: string,
    customPaywallTraits?: Record<string, any>,
  ): void;

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

  handleDeepLink(urlString: string): boolean;

  setRevenueCatAppUserId(rcAppUserId: string): void;

  hasAnyActiveSubscription(): Promise<boolean>;

  hasAnyEntitlement(): Promise<boolean>;

  resetHelium(): void;

  setCustomRestoreFailedStrings(
    customTitle?: string,
    customMessage?: string,
    customCloseButtonText?: string,
  ): void;

  disableRestoreFailedDialog(): void;

  getExperimentInfoForTrigger(trigger: string): ExperimentInfoResult;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<HeliumPaywallSdkModule>("HeliumPaywallSdk");
