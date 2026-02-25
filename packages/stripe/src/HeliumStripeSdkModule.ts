import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

declare class HeliumStripeSdkModule extends NativeModule {
  initializeStripe(config: Record<string, any>): void;

  setUserIdAndSyncStripeIfNeeded(userId: string): void;

  resetStripeEntitlements(clearUserId: boolean): void;

  createStripePortalSession(returnUrl: string): Promise<string>;

  hasActiveStripeEntitlement(): Promise<boolean>;
}

// Only resolve the native module on iOS. On Android there is no native
// HeliumStripeSdk module — all exported functions guard on Platform.OS
// before touching this reference.
export default (Platform.OS === "ios"
  ? requireNativeModule<HeliumStripeSdkModule>("HeliumStripeSdk")
  : null) as HeliumStripeSdkModule;
