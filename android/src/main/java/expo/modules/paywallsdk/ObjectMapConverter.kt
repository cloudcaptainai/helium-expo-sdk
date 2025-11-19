package expo.modules.paywallsdk

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Utilities for converting arbitrary Kotlin objects to JSON-compatible Maps.
 * Handles kotlinx.serialization types from the Helium SDK and uses reflection for unknown types.
 */

/**
 * Converts a JSONObject to a Map<String, Any?> recursively.
 * Handles nested objects and arrays.
 */
fun jsonObjectToMap(jsonObject: org.json.JSONObject): Map<String, Any?> {
  val map = mutableMapOf<String, Any?>()
  val keys = jsonObject.keys()
  while (keys.hasNext()) {
    val key = keys.next()
    map[key] = jsonValueToAny(jsonObject.get(key))
  }
  return map
}

/**
 * Converts a JSON value to its corresponding Kotlin type.
 */
fun jsonValueToAny(value: Any?): Any? {
  return when (value) {
    is org.json.JSONObject -> jsonObjectToMap(value)
    is org.json.JSONArray -> {
      val list = mutableListOf<Any?>()
      for (i in 0 until value.length()) {
        list.add(jsonValueToAny(value.get(i)))
      }
      list
    }
    org.json.JSONObject.NULL -> null
    else -> value
  }
}

/**
 * Converts a kotlinx.serialization JsonObject to a Map.
 */
fun kotlinxJsonObjectToMap(jsonObject: JsonObject): Map<String, Any?> {
  return jsonObject.entries.associate { (key, value) ->
    key to kotlinxJsonElementToAny(value)
  }
}

/**
 * Converts a kotlinx.serialization JsonArray to a List.
 */
fun kotlinxJsonArrayToList(jsonArray: JsonArray): List<Any?> {
  return jsonArray.map { kotlinxJsonElementToAny(it) }
}

/**
 * Converts a kotlinx.serialization JsonElement to an appropriate Kotlin type.
 */
fun kotlinxJsonElementToAny(element: JsonElement): Any? {
  return when (element) {
    is JsonObject -> kotlinxJsonObjectToMap(element)
    is JsonArray -> kotlinxJsonArrayToList(element)
    is JsonPrimitive -> {
      when {
        element is JsonNull -> null
        element.booleanOrNull != null -> element.booleanOrNull
        element.longOrNull != null -> element.longOrNull
        element.doubleOrNull != null -> element.doubleOrNull
        else -> element.contentOrNull
      }
    }
    else -> null
  }
}

/**
 * Converts an arbitrary object to a Map using reflection.
 * This allows serialization without external dependencies like Gson.
 * If a field cannot be converted, it will be skipped rather than causing the entire conversion to fail.
 */
fun objectToMap(obj: Any?): Map<String, Any?> {
  if (obj == null) return emptyMap()

  val result = mutableMapOf<String, Any?>()
  val clazz = obj.javaClass

  // Get all fields including inherited ones
  var currentClass: Class<*>? = clazz
  while (currentClass != null && currentClass != Any::class.java) {
    for (field in currentClass.declaredFields) {
      // Skip synthetic fields (like companion objects)
      if (field.isSynthetic) continue

      try {
        field.isAccessible = true
        val name = field.name
        val value = field.get(obj)
        result[name] = convertAnyValue(value)
      } catch (e: Exception) {
        // Skip this field if conversion fails - log warning but don't crash
        android.util.Log.w("HeliumPaywallSdk", "Failed to convert field '${field.name}' of type ${field.type.name}: ${e.message}")
      }
    }
    currentClass = currentClass.superclass
  }
  return result
}

/**
 * Converts a value to a JSON-compatible type.
 * Handles kotlinx.serialization types from the Helium SDK.
 * Returns null if conversion fails to prevent crashes.
 */
fun convertAnyValue(value: Any?): Any? {
  return try {
    when (value) {
      null -> null
      is String, is Number, is Boolean, is Char -> value
      // Handle kotlinx.serialization types from Helium SDK
      is JsonObject -> kotlinxJsonObjectToMap(value)
      is JsonArray -> kotlinxJsonArrayToList(value)
      is JsonPrimitive -> kotlinxJsonElementToAny(value)
      is JsonElement -> kotlinxJsonElementToAny(value)
      // Handle standard Kotlin types
      is List<*> -> value.map { convertAnyValue(it) }
      is Array<*> -> value.map { convertAnyValue(it) }
      is Map<*, *> -> value.mapValues { convertAnyValue(it.value) }
      is Enum<*> -> value.name
      else -> {
        // Try reflection as last resort for unknown types
        try {
          objectToMap(value)
        } catch (e: Exception) {
          // If reflection fails, use string representation
          android.util.Log.w("HeliumPaywallSdk", "Using toString() for unsupported type ${value.javaClass.name}")
          value.toString()
        }
      }
    }
  } catch (e: Exception) {
    // If all else fails, return null for this value to prevent crashes
    android.util.Log.w("HeliumPaywallSdk", "Failed to convert value of type ${value?.javaClass?.name}: ${e.message}")
    null
  }
}
