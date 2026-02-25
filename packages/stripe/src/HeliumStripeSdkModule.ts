import { NativeModule, requireNativeModule } from "expo";

declare class HeliumStripeSdkModule extends NativeModule {
    initializeStripe(config: Record<string, any>): void;
    setUserIdAndSyncStripeIfNeeded(userId: string): void;
    resetStripeEntitlements(clearUserId: boolean): void;
    createStripePortalSession(returnUrl: string): Promise<string>;
    hasActiveStripeEntitlement(): Promise<boolean>;
}

export default requireNativeModule<HeliumStripeSdkModule>("HeliumStripeSdk");
