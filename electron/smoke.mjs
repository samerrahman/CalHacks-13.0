// Offline native import gate. No credential output or camera acquisition.
try {
  const sdk = await import('@smartspectra/node-sdk');
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, sdk: sdk.SmartSpectraSDK.version, nativeRuntimeLoaded: true, pulseMetric: sdk.MetricType.PULSE_RATE, liveCaptureTested: false }));
} catch (error) { console.error('Native runtime import failed:', error.message); process.exitCode = 1; }
