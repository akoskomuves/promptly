import { loadConfig, saveConfig } from "../config.js";

export async function loginCommand(options: { apiUrl?: string }) {
  const config = loadConfig();

  if (options.apiUrl) {
    config.apiUrl = options.apiUrl;
  }

  // For MVP: simple token-based auth
  // In production this would open a browser for OAuth/Clerk
  console.log(`API URL: ${config.apiUrl}`);
  console.log(
    "For now, set your token manually in ~/.promptly/config.json"
  );
  console.log('Add: "token": "your-api-token"');

  saveConfig(config);
  console.log("\nConfig saved to ~/.promptly/config.json");
}
