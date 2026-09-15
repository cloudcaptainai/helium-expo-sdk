/**
 * Recursively converts boolean values to special marker strings to preserve
 * type information when passing through native bridge.
 *
 * Native bridge converts booleans to NSNumber (0/1), making them
 * indistinguishable from actual numeric values. This helper converts:
 * - true -> "__helium_rn_bool_true__"
 * - false -> "__helium_rn_bool_false__"
 * - All other values remain unchanged
 */
export function convertBooleansToMarkers(input: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!input) return undefined;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    // Strip null/undefined values — native SDKs ignore them and it complicates bridging code
    if (value == null) continue;
    result[key] = convertValueBooleansToMarkers(value);
  }
  return result;
}
/**
 * Helper to recursively convert booleans in any value type
 */
function convertValueBooleansToMarkers(value: any): any {
  if (typeof value === 'boolean') {
    return value ? "__helium_rn_bool_true__" : "__helium_rn_bool_false__";
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    return convertBooleansToMarkers(value);
  } else if (value && Array.isArray(value)) {
    return value.map(convertValueBooleansToMarkers);
  }
  return value;
}
