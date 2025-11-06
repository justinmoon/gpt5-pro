# GPT-5 Pro CLI

Script the official ChatGPT UI so your own agents can tap GPT-5 Pro as a reliable oracle whenever they hit a wall.

## Usage

1. Install dependencies and build once:
   ```bash
   npm install
   npm run build
   ```
2. Capture a session (a visible browser opens the first time so you can handle CAPTCHA or 2FA):
   ```bash
   npm start -- login
   ```
3. Ask questions headlessly from scripts or other agents:
   ```bash
   npm start -- "Find the root cause of this TypeScript type error..."
   ```
Useful flags:
- `-p <profile>` keeps separate sessions for different accounts.
- `-v` forces a visible browser when you need to watch a run.
- `--verbose` emits step-by-step automation logs.
