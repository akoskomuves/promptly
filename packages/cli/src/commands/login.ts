import http from "node:http";
import crypto from "node:crypto";
import { loadConfig, saveConfig } from "../config.js";

// Clerk OAuth configuration
const CLERK_CLIENT_ID = "lOZ4jhsojay29pkZ";
const CLERK_AUTHORIZE_URL = "https://flexible-panda-27.clerk.accounts.dev/oauth/authorize";
const CLERK_TOKEN_URL = "https://flexible-panda-27.clerk.accounts.dev/oauth/token";

// Generate PKCE code verifier and challenge
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export async function loginCommand(options: { apiUrl?: string }) {
  const config = loadConfig();

  if (options.apiUrl) {
    config.apiUrl = options.apiUrl;
  }

  const apiUrl = config.apiUrl || "https://api.getpromptly.xyz";

  // Generate PKCE values
  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString("hex");

  // Find a free port and start a temporary server to receive the callback
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://localhost:${port}/callback`;

  // Build OAuth authorize URL
  const authorizeUrl = new URL(CLERK_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", CLERK_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "profile email");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);

  console.log("Opening browser for sign-in...");
  console.log(`If it doesn't open, visit: ${authorizeUrl.toString()}`);

  // Open browser
  try {
    const open = (await import("open")).default;
    await open(authorizeUrl.toString());
  } catch {
    console.log("Could not open browser automatically.");
  }

  // Wait for callback with authorization code
  const authCode = await new Promise<{ code: string; state: string } | null>((resolve) => {
    const timeout = setTimeout(() => {
      console.log("\nLogin timed out after 2 minutes.");
      resolve(null);
    }, 120_000);

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; background: #0a0a0a; color: #ededed; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1>✗ Sign-in failed</h1>
                  <p style="color: #888;">${error}</p>
                </div>
              </body>
            </html>
          `);
          clearTimeout(timeout);
          resolve(null);
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: system-ui; background: #0a0a0a; color: #ededed; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
              <div style="text-align: center;">
                <h1>✓ Completing sign-in...</h1>
                <p style="color: #888;">You can close this tab.</p>
              </div>
            </body>
          </html>
        `);

        clearTimeout(timeout);
        resolve(code && returnedState ? { code, state: returnedState } : null);
      }
    });
  });

  server.close();

  if (!authCode) {
    console.log("Login failed. No authorization code received.");
    process.exit(1);
  }

  // Verify state to prevent CSRF
  if (authCode.state !== state) {
    console.log("Login failed. State mismatch (possible CSRF attack).");
    process.exit(1);
  }

  // Exchange authorization code for access token
  console.log("Exchanging authorization code for token...");

  const tokenResponse = await fetch(CLERK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLERK_CLIENT_ID,
      code: authCode.code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    console.log(`Login failed. Token exchange error: ${error}`);
    process.exit(1);
  }

  const tokenData = (await tokenResponse.json()) as { access_token: string };
  const accessToken = tokenData.access_token;

  // Exchange Clerk access token for our API key
  console.log("Getting API key...");

  const apiKeyResponse = await fetch(`${apiUrl}/auth/token-exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!apiKeyResponse.ok) {
    const error = await apiKeyResponse.text();
    console.log(`Login failed. API key exchange error: ${error}`);
    process.exit(1);
  }

  const apiKeyData = (await apiKeyResponse.json()) as { apiKey: string; email: string };

  // Save token and switch to cloud mode
  config.token = apiKeyData.apiKey;
  config.mode = "cloud";
  config.userEmail = apiKeyData.email;

  saveConfig(config);

  console.log(`\nLogged in as ${apiKeyData.email}`);
  console.log("Config saved to ~/.promptly/config.json");
  console.log("Mode set to: cloud");
}
