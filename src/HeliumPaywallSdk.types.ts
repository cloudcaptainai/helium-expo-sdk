import type { StyleProp, ViewStyle } from 'react-native';

export type OnLoadEventPayload = {
  url: string;
};

export type HeliumPaywallSdkModuleEvents = {
  onHeliumPaywallEvent: (params: HeliumPaywallEvent) => void;
};

export type HeliumPaywallEvent = {
  value: string;
};

export type HeliumPaywallSdkViewProps = {
  url: string;
  onLoad: (event: { nativeEvent: OnLoadEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};
