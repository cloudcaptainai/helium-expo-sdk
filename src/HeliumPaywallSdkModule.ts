import { NativeModule, requireNativeModule } from 'expo';

import { HeliumPaywallSdkModuleEvents } from './HeliumPaywallSdk.types';

declare class HeliumPaywallSdkModule extends NativeModule<HeliumPaywallSdkModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<HeliumPaywallSdkModule>('HeliumPaywallSdk');
