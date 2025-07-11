import * as React from 'react';

import { HeliumPaywallSdkViewProps } from './HeliumPaywallSdk.types';

export default function HeliumPaywallSdkView(props: HeliumPaywallSdkViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
