import * as React from 'react';
import { useState } from 'react';
import { Platform } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { convertBooleansToMarkers } from './booleanMarkers';
import type {
  HeliumPaywallEvent,
  HeliumPaywallViewProps,
  PaywallEntitledEvent,
} from './HeliumPaywallSdk.types';
import { dispatchPaywallEvent } from './paywallEventDispatch';

type NativeHeliumPaywallViewProps = {
  triggerName: string;
  customPaywallTraits?: Record<string, any>;
  onPaywallEvent: (event: { nativeEvent: HeliumPaywallEvent }) => void;
  onEntitledEvent: (event: { nativeEvent: Partial<PaywallEntitledEvent> }) => void;
  onPaywallNotShown: () => void;
  style?: StyleProp<ViewStyle>;
};

let NativeView: React.ComponentType<NativeHeliumPaywallViewProps> | undefined;
let warnedUnsupportedPlatform = false;

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
 *
 * You own presentation and dismissal: the view stays mounted after the paywall closes, so hide it
 * from `onEntitled` (purchase, restore, already entitled) and `eventHandlers.onDismissed`.
 * `paywallClose` fires as the view unmounts, after its handlers are gone, so `onClose` is not a
 * place to hide it from.
 */
export function HeliumPaywallView({
  triggerName,
  eventHandlers,
  onEntitled,
  customPaywallTraits,
  paywallNotShownReplacement,
  style,
}: HeliumPaywallViewProps) {
  const [paywallNotShown, setPaywallNotShown] = useState(false);

  // There is no Android view yet; rendering the native component there would fail.
  if (Platform.OS !== 'ios') {
    if (!warnedUnsupportedPlatform) {
      warnedUnsupportedPlatform = true;
      console.warn('[Helium] HeliumPaywallView is iOS only for now; rendering nothing on', Platform.OS);
    }
    return null;
  }
  if (paywallNotShown) {
    return React.createElement(React.Fragment, null, paywallNotShownReplacement);
  }
  let NativePaywallView: React.ComponentType<NativeHeliumPaywallViewProps>;
  try {
    NativePaywallView = resolveNativeView();
  } catch (e) {
    console.error('[Helium] HeliumPaywallView native view is not available', e);
    return React.createElement(React.Fragment, null, paywallNotShownReplacement);
  }
  return React.createElement(NativePaywallView, {
    triggerName,
    customPaywallTraits: convertBooleansToMarkers(customPaywallTraits),
    onPaywallEvent: ({ nativeEvent }) => {
      if (eventHandlers) {
        dispatchPaywallEvent(eventHandlers, nativeEvent, 'embedded');
      }
    },
    onEntitledEvent: ({ nativeEvent }) => {
      try {
        onEntitled?.(nativeEvent?.type ? (nativeEvent as PaywallEntitledEvent) : undefined);
      } catch (e) {
        console.error('[Helium] onEntitled callback failed', e);
      }
    },
    onPaywallNotShown: () => setPaywallNotShown(true),
    style,
  });
}
