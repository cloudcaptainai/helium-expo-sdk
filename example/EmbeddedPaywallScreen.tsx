import { StyleSheet, Text, View } from 'react-native';
import { HeliumPaywallView } from 'expo-helium';

type Props = {
  trigger: string;
  onEntitled: () => void;
  onDismissed: () => void;
};

export function EmbeddedPaywallScreen({ trigger, onEntitled, onDismissed }: Props) {
  return (
    <View style={styles.screen}>
      <HeliumPaywallView
        triggerName={trigger}
        style={styles.paywall}
        onEntitled={onEntitled}
        eventHandlers={{
          onAnyEvent: (event) => console.log('[Example] embedded event →', event.type),
          onDismissed,
        }}
        paywallNotShownReplacement={<Text style={styles.notShown}>Paywall not shown</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  paywall: {
    flex: 1,
  },
  notShown: {
    margin: 20,
    color: '#555',
  },
});
