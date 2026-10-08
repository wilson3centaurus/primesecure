import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun setting(property: String, env: String): String =
    System.getenv(env)?.takeIf { it.isNotBlank() }
        ?: providers.gradleProperty(property).orNull.orEmpty()

android {
    namespace = "com.robokorda.primesecure"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.robokorda.primesecure"
        minSdk = 26
        targetSdk = 34
        versionCode = System.getenv("AGENT_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = System.getenv("AGENT_VERSION_NAME") ?: "0.1.0"

        buildConfigField("String", "SUPABASE_URL", "\"${setting("primesecure.url", "PRIMESECURE_URL")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${setting("primesecure.anonKey", "PRIMESECURE_ANON_KEY")}\"")
    }

    buildTypes {
        debug {
            // testOnly lets adb remove the Device Owner without a factory reset.
            manifestPlaceholders["testOnly"] = "true"
            manifestPlaceholders["cleartext"] = "true"
        }
        release {
            isMinifyEnabled = false
            manifestPlaceholders["testOnly"] = "false"
            manifestPlaceholders["cleartext"] = "false"
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.work:work-runtime-ktx:2.10.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
