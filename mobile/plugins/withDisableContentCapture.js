const { withMainActivity, withMainApplication } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to disable Android ContentCapture.
 *
 * ContentCapture traverses view trees during app transitions and backgrounding
 * for AI suggestions/autofill, causing main-thread ANRs in media/list heavy apps
 * on modern Android versions (Android 14+, Android 16/SDK 36, OxygenOS/ColorOS).
 */
const withDisableContentCapture = (config) => {
  // 1. Configure MainActivity.kt
  config = withMainActivity(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    // Add necessary imports if missing
    if (!contents.includes('import android.view.contentcapture.ContentCaptureManager')) {
      contents = contents.replace(
        'import android.os.Bundle',
        'import android.os.Bundle\nimport android.view.View\nimport android.view.contentcapture.ContentCaptureManager'
      );
    }

    // Add disableContentCapture() helper and calls if missing
    if (!contents.includes('disableContentCapture()')) {
      const helperMethod = `
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    disableContentCapture()
  }

  private fun disableContentCapture() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      try {
        val contentCaptureManager = getSystemService(ContentCaptureManager::class.java)
        contentCaptureManager?.setContentCaptureEnabled(false)
      } catch (_: Throwable) {}

      try {
        window?.decorView?.importantForContentCapture = View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS
      } catch (_: Throwable) {}
    }
  }
`;
      // Call inside onCreate right after super.onCreate
      contents = contents.replace(
        /super\.onCreate\(null\)/,
        'super.onCreate(null)\n    disableContentCapture()'
      );

      // Append helper functions before the end of the class
      const lastBraceIdx = contents.lastIndexOf('}');
      if (lastBraceIdx !== -1) {
        contents = contents.slice(0, lastBraceIdx) + helperMethod + '\n}\n';
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  // 2. Configure MainApplication.kt
  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    if (!contents.includes('import android.view.contentcapture.ContentCaptureManager')) {
      contents = contents.replace(
        'import android.content.res.Configuration',
        'import android.content.res.Configuration\nimport android.os.Build\nimport android.view.contentcapture.ContentCaptureManager'
      );
    }

    if (!contents.includes('ContentCaptureManager::class.java')) {
      const disableBlock = `
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      try {
        val ccm = getSystemService(ContentCaptureManager::class.java)
        ccm?.setContentCaptureEnabled(false)
      } catch (_: Throwable) {}
    }
`;
      contents = contents.replace(
        /super\.onCreate\(\)/,
        'super.onCreate()\n' + disableBlock
      );
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  return config;
};

module.exports = withDisableContentCapture;
