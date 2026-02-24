import type { HeliumConfig } from "expo-helium";

export interface StripeHeliumConfig extends HeliumConfig {
  stripePublishableKey: string;
  merchantIdentifier: string;
  merchantName: string;
  managementURL: string;
  countryCode?: string; // default "US"
  currencyCode?: string; // default "USD"
}
