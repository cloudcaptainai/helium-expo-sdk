import { requireNativeView } from 'expo';
import * as React from 'react';

import { HeliumPaywallSdkViewProps } from './HeliumPaywallSdk.types';

const NativeView: React.ComponentType<HeliumPaywallSdkViewProps> =
  requireNativeView('HeliumPaywallSdk');

export default function HeliumPaywallSdkView(props: HeliumPaywallSdkViewProps) {
  return <NativeView {...props} />;
}
