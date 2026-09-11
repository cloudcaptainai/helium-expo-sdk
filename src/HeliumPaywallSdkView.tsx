import * as React from 'react';
import { useState } from 'react';
import { Platform } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { convertBooleansToMarkers } from './booleanMarkers';
import type { HeliumPaywallEvent, HeliumPaywallViewProps } from './HeliumPaywallSdk.types';
import { dispatchPaywallEvent } from './paywallEventDispatch';

type NativeHeliumPaywallViewProps = {
  triggerName: string;
  customPaywallTraits?: Record<string, any>;
  onPaywallEvent: (event: { nativeEvent: HeliumPaywallEvent }) => void;
  onPaywallNotShown: () => void;
  style?: StyleProp<ViewStyle>;
};

let NativeView: React.ComponentType<NativeHeliumPaywallViewProps> | undefined;

function resolveNativeView(): React.ComponentType<NativeHeliumPaywallViewProps> {
  if (!NativeView) {
    const expo: typeof import('expo') = require('expo');
    NativeView = expo.requireNativeView('HeliumPaywallSdk');
  }
  return NativeView;
}

/**
 * Renders the paywall for a trigger inline, as part of your own screen. Most integrations should
 * use `presentUpsell`; reach for this view for custom inline placements such as an onboarding step
 * or an upgrade tab. iOS only for now; it renders nothing on Android.
 *
 * You must have a trigger and workflow configured in the Helium dashboard
 * (https://app.tryhelium.com/workflows). See `HeliumPaywallViewProps` for `eventHandlers`,
 * `paywallNotShownReplacement`, and the load-once behavior.
 */
export function HeliumPaywallView({
  triggerName,
  eventHandlers,
  customPaywallTraits,
  paywallNotShownReplacement,
  style,
}: HeliumPaywallViewProps) {
  const [paywallNotShown, setPaywallNotShown] = useState(false);

  if (Platform.OS !== 'ios') {
    return null;
  }
  if (paywallNotShown) {
    return React.createElement(React.Fragment, null, paywallNotShownReplacement);
  }
  return React.createElement(resolveNativeView(), {
    triggerName,
    customPaywallTraits: convertBooleansToMarkers(customPaywallTraits),
    onPaywallEvent: ({ nativeEvent }) => {
      if (eventHandlers) {
        dispatchPaywallEvent(eventHandlers, nativeEvent, 'embedded');
      }
    },
    onPaywallNotShown: () => setPaywallNotShown(true),
    style,
  });
}
