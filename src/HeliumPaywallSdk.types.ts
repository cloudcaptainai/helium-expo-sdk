import type { StyleProp, ViewStyle } from 'react-native';

export type OnLoadEventPayload = {
  url: string;
};

export type HeliumPaywallSdkModuleEvents = {
  onHeliumPaywallEvent: (params: HeliumPaywallEvent) => void;
  onDelegateActionEvent: (params: DelegateActionEvent) => void;
};
export type HeliumPaywallEvent = {
  type: string;
  triggerName?: string;
  paywallTemplateName?: string;
  productKey?: string;
  ctaName?: string;
  configId?: string;
  numAttempts?: number;
  downloadTimeTakenMS?: number;
  webviewRenderTimeTakenMS?: number;
  imagesDownloadTimeTakenMS?: number;
  fontsDownloadTimeTakenMS?: number;
  bundleDownloadTimeMS?: number;
  dismissAll?: boolean;
  errorDescription?: string;
};
export type DelegateActionEvent = {
  type: 'purchase' | 'restore';
  productId?: string;
};

export type HeliumPaywallSdkViewProps = {
  url: string;
  onLoad: (event: { nativeEvent: OnLoadEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};

export type HeliumTransactionStatus = 'purchased' | 'failed' | 'cancelled' | 'pending' | 'restored';
export type HeliumPurchaseResult = {
  status: HeliumTransactionStatus;
  error?: string; // Optional error message
};
export type HeliumDownloadStatus = 'downloadSuccess' | 'downloadFailure' | 'inProgress' | 'notDownloadedYet';

// --- Purchase Configuration Types ---

/** Interface for providing custom purchase handling logic. */

export interface HeliumPurchaseConfig {
  makePurchase: (productId: string) => Promise<HeliumPurchaseResult>;
  restorePurchases: () => Promise<boolean>;

  /** Optional RevenueCat API Key. If not provided, RevenueCat must be configured elsewhere. */
  apiKey?: string;
}

// Helper function for creating Custom Purchase Config
export function createCustomPurchaseConfig(callbacks: {
  makePurchase: (productId: string) => Promise<HeliumPurchaseResult>;
  restorePurchases: () => Promise<boolean>;
}): HeliumPurchaseConfig {
  return {
    makePurchase: callbacks.makePurchase,
    restorePurchases: callbacks.restorePurchases,
  };
}

export interface HeliumConfig {
  /** Your Helium API Key */
  apiKey: string;
  /** Configuration for handling purchases. Can be custom functions or a pre-built handler config. */
  purchaseConfig: HeliumPurchaseConfig;
  /** Callback for receiving all Helium paywall events. */
  onHeliumPaywallEvent: (event: HeliumPaywallEvent) => void; // Still mandatory

  // Optional configurations
  triggers?: string[];
  customUserId?: string;
  customAPIEndpoint?: string;
  customUserTraits?: Record<string, any>;
  revenueCatAppUserId?: string;
}

export interface NativeHeliumConfig {
  apiKey: string;
  customUserId?: string;
  customAPIEndpoint?: string;
  customUserTraits?: Record<string, any>;
  revenueCatAppUserId?: string;
}

export interface PaywallInfo {
  paywallTemplateName: string;
  shouldShow: boolean;
}

export const HELIUM_CTA_NAMES = {
  SCHEDULE_CALL: 'schedule_call',
  SUBSCRIBE_BUTTON: 'subscribe_button',
}
