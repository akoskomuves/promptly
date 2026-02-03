import crypto from "node:crypto";
import { loadConfig, saveConfig } from "../config.js";

export async function loginCommand(options: { apiUrl?: string }) {
  const config = loadConfig();

  if (options.apiUrl) {
    config.apiUrl = options.apiUrl;
  }

  const apiUrl = config.apiUrl || "https://api.getpromptly.xyz";

  // Step 1: Request a device code from the API
  console.log("Requesting login code...");

  const deviceCode = crypto.randomBytes(16).toString("hex");

  const initResponse = await fetch(`${apiUrl}/auth/device/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceCode }),
  });

  if (!initResponse.ok) {
    const error = await initResponse.text();
    console.log(`Login failed: ${error}`);
    process.exit(1);
  }

  const { verificationUrl } = (await initResponse.json()) as { verificationUrl: string };

  // Step 2: Open browser to verification URL
  console.log("\nOpening browser for sign-in...");
  console.log(`If it doesn't open, visit: ${verificationUrl}`);

  try {
    const open = (await import("open")).default;
    await open(verificationUrl);
  } catch {
    console.log("Could not open browser automatically.");
  }

  // Step 3: Poll for completion
  console.log("\nWaiting for sign-in...");

  const startTime = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 2000; // 2 seconds

  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const pollResponse = await fetch(`${apiUrl}/auth/device/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });

    if (pollResponse.status === 200) {
      const data = (await pollResponse.json()) as { apiKey: string; email: string };

      // Save token and switch to cloud mode
      config.token = data.apiKey;
      config.mode = "cloud";
      config.userEmail = data.email;
      config.apiUrl = apiUrl;

      saveConfig(config);

      console.log(`\nLogged in as ${data.email}`);
      console.log("Config saved to ~/.promptly/config.json");
      console.log("Mode set to: cloud");
      return;
    }

    if (pollResponse.status === 408) {
      // Still waiting, continue polling
      process.stdout.write(".");
      continue;
    }

    // Error
    const error = await pollResponse.text();
    console.log(`\nLogin failed: ${error}`);
    process.exit(1);
  }

  console.log("\nLogin timed out after 5 minutes.");
  process.exit(1);
}
