import { setTelemetryEnabled, getTelemetryStatus } from "../analytics.js";

export function telemetryCommand(action?: string): void {
  switch (action) {
    case "on": {
      setTelemetryEnabled(true);
      const status = getTelemetryStatus();
      console.log("Telemetry preference set to ON.");
      if (status.state !== "active") {
        console.log(`Note: ${status.reason}`);
      } else {
        console.log("Active in cloud mode. Disable any time with: promptly telemetry off");
      }
      break;
    }
    case "off": {
      setTelemetryEnabled(false);
      console.log("Telemetry disabled. No usage events will be sent.");
      console.log("Re-enable any time with: promptly telemetry on");
      break;
    }
    case undefined:
    case "":
    case "status": {
      const status = getTelemetryStatus();
      console.log(`Telemetry: ${status.state === "active" ? "ON" : "OFF"}`);
      console.log(status.reason);
      if (status.state === "active") {
        console.log("");
        console.log("Sent: event name, CLI version, OS, anonymous-or-email distinct id.");
        console.log("Not sent: prompt content, code, file paths, transcripts.");
      }
      break;
    }
    default:
      console.error(`Unknown action '${action}'. Use: promptly telemetry [on|off|status]`);
      process.exit(1);
  }
}
