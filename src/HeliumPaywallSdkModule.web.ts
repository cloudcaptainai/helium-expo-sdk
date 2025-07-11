import { registerWebModule, NativeModule } from 'expo';

import { HeliumPaywallSdkModuleEvents } from './HeliumPaywallSdk.types';

class HeliumPaywallSdkModule extends NativeModule<HeliumPaywallSdkModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
}

export default registerWebModule(HeliumPaywallSdkModule, 'HeliumPaywallSdkModule');
