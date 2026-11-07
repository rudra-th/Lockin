# Lockin release rules.
#
# Capacitor and its plugins are reached through the bridge and annotations, so
# R8 must keep the plugin surface and anything it reflects over.

-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keep @com.getcapacitor.PluginMethod class * { *; }

# The native side of Lockin is small and registered by class name.
-keep class com.lockin.app.** { *; }

# Capacitor plugins commonly reflect over their own JS-facing methods.
-keep class com.capacitorjs.plugins.** { *; }
-keep class io.capawesome.capacitorjs.plugins.** { *; }

# Do not warn about optional Firebase classes when auth is not configured.
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# The Firebase Auth plugin carries handlers for providers this app never
# enables (Facebook among them). Their SDKs are not dependencies; the handlers
# are unreachable because only google.com is configured.
-dontwarn com.facebook.**
-dontwarn com.apple.**
-dontwarn com.twitter.**
