import { Button, StyleSheet, Text, View } from 'react-native';
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
        paywallNotShownReplacement={
          <View style={styles.notShown}>
            <Text>Paywall not shown</Text>
            <Button title="Go back" onPress={onDismissed} />
          </View>
        }
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
});
