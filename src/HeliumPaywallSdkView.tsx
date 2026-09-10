import * as React from 'react';

import { convertBooleansToMarkers } from './booleanMarkers';
import type { HeliumPaywallViewProps } from './HeliumPaywallSdk.types';

let NativeView: React.ComponentType<HeliumPaywallViewProps> | undefined;

function resolveNativeView(): React.ComponentType<HeliumPaywallViewProps> {
  if (!NativeView) {
    const expo: typeof import('expo') = require('expo');
    NativeView = expo.requireNativeView('HeliumPaywallSdk');
  }
  return NativeView;
}

export function HeliumPaywallView({ triggerName, customPaywallTraits, style }: HeliumPaywallViewProps) {
  return React.createElement(resolveNativeView(), {
    triggerName,
    customPaywallTraits: convertBooleansToMarkers(customPaywallTraits),
    style,
  });
}
