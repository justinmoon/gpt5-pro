# GPT-5 Pro CLI

A production-ready CLI tool to interact with ChatGPT-5 Pro via browser automation using Playwright.

**Features:**
- ✓ GPT-5 Pro model selection (automatic)
- ✓ Multiple authentication methods (email/password, Google OAuth)
- ✓ Profile support for multiple accounts
- ✓ Session persistence for headless operation
- ✓ Configurable timeouts and retries
- ✓ Structured logging with verbose mode
- ✓ Resilient selectors for stable automation

**Important:**
- First login requires visible browser (to solve CAPTCHA if needed)
- After first login, session is saved for fast headless use
- Supports 2FA for both native and Google OAuth logins

## Setup

### Option A: With Nix (Recommended)

1. Enter the Nix development shell:
```bash
nix develop
# or if you have direnv: direnv allow
```

2. Install dependencies:
```bash
npm install
```

3. Configure credentials (see below)

4. Build the project:
```bash
npm run build
```

Note: Playwright browsers are provided by Nix, no separate installation needed!

### Option B: Without Nix

1. Install dependencies:
```bash
npm install
```

2. Install Chromium browser for Playwright:
```bash
npx playwright install chromium
```

3. Build the project:
```bash
npm run build
```

## Usage

### Credentials

**Secure by default:** The tool prompts for your email and password interactively (like SSH). Your credentials are:
- ✓ Never saved to disk
- ✓ Only in memory during the login session
- ✓ Password hidden while typing (shows `****`)

**Optional alternatives:**
- Use `.env` file for convenience (see Advanced Configuration)
- Use 1Password CLI for password management (see Advanced Configuration)

### First Time: Login

Run the login command once to authenticate and save your session:

```bash
npm start -- login
```

You'll be prompted:
```
OpenAI Email: your-email@example.com
OpenAI Password (input hidden):
********
```

Then the tool will:
1. Open a browser window (visible mode)
2. Automatically fill email and password
3. **If CAPTCHA appears, solve it manually**
4. Enter 2FA code if prompted (via CLI)
5. Save your session to `~/.gpt5-pro-cli/default/`

**Note:** Google may show a CAPTCHA on first login - just solve it in the browser window. Future runs will use the saved session (no credentials needed).

### Normal Usage: Query ChatGPT

Once logged in, query ChatGPT in headless mode:

```bash
npm start -- "Explain quantum computing in simple terms"
```

The tool will automatically:
- Load your saved session
- Select GPT-5 Pro model
- Submit your prompt
- Wait for the complete response
- Display the result

### CLI Options

**Login command:**
```bash
npm start -- login [options]

Options:
  -p, --profile <name>  Profile name for session storage (default: "default")
  -v, --visible         Show browser window (not headless)
  --verbose             Enable verbose logging
```

**Query command:**
```bash
npm start -- [options] "your prompt"

Options:
  -v, --visible         Show browser window (useful for debugging)
  -p, --profile <name>  Use specific profile (default: "default")
  -m, --model <name>    Specify model (default: "GPT-5 Pro")
  -t, --timeout <ms>    Set timeout in milliseconds (default: 60000)
  -r, --retries <n>     Set retry count (default: 2)
  --verbose             Enable debug logging
```

**Examples:**

```bash
# Basic query
npm start -- "Hello GPT-5!"

# Use different model
npm start -- -m "GPT-4" "Explain TypeScript"

# Debug mode with visible browser
npm start -- -v --verbose "Test prompt"

# Use different profile (for multiple accounts)
npm start -- login -p work
npm start -- -p work "Query using work account"

# Increase timeout for long responses
npm start -- -t 120000 "Write a detailed essay"
```

### With Nix

```bash
# Login
nix run . -- login

# Query
nix run . -- "What is TypeScript?"

# With options
nix run . -- -v --verbose "Debug query"

# Multiple profiles
nix run . -- login -p work
nix run . -- -p work "Work query"
```

## How it works

**Login mode:**
1. Opens browser to chatgpt.com
2. Detects authentication type (Google OAuth or native)
3. Enters email and password from `.env` or 1Password
4. Handles 2FA if enabled (prompts you for code)
5. Verifies login success via chat interface detection
6. Saves session to `~/.gpt5-pro-cli/<profile>/browser-state.json`

**Query mode:**
1. Loads saved session from profile
2. Navigates to ChatGPT in headless mode
3. Selects GPT-5 Pro model (or specified model)
4. Counts existing assistant messages
5. Submits your prompt
6. Waits for new assistant message to appear
7. Monitors response until stable (no changes for 3 seconds)
8. Extracts and outputs complete response

## Troubleshooting

### "Not logged in" error
- Run `npm start -- login` to create a new session
- If using profiles, ensure you login with the same profile: `npm start -- login -p <profile>`
- Check that `~/.gpt5-pro-cli/<profile>/browser-state.json` exists

### CAPTCHA appears
- CAPTCHAs are normal on first login
- The tool waits up to 60 seconds for you to solve it manually
- Use `-v` flag to see the browser and solve the CAPTCHA
- After first login, saved session prevents future CAPTCHAs

### Response timeout
- Increase timeout: `npm start -- -t 120000 "your prompt"`
- Increase retries: `npm start -- -r 5 "your prompt"`
- Use `--verbose` to see detailed logs

### Model selection fails
- The tool will warn but continue with the default model
- Use `-v --verbose` to debug model picker interaction
- ChatGPT UI may change - selectors may need updating

### Multiple accounts
- Use profiles to manage multiple accounts:
  ```bash
  npm start -- login -p personal
  npm start -- login -p work
  npm start -- -p personal "query 1"
  npm start -- -p work "query 2"
  ```

### Session expired
- Sessions eventually expire (typically after days/weeks)
- Re-run `npm start -- login` to create a new session
- Use `-v` to see the login process

## Advanced Configuration

### Credential Storage Options

By default, the tool prompts for credentials interactively (most secure). You can optionally configure automatic credential loading:

**Option 1: .env file (convenience)**

Create a `.env` file in the project root:
```env
OPENAI_EMAIL=your-email@example.com
OPENAI_PASSWORD=your-password
```

**Option 2: 1Password CLI (recommended for automation)**

Use 1Password CLI for secure password management:

```env
USE_1PASSWORD=true
ONEPASSWORD_EMAIL_REF=op://Private/OpenAI/username
ONEPASSWORD_PASSWORD_REF=op://Private/OpenAI/password
```

Make sure `op` CLI is installed and you're logged in:
```bash
op signin
```

**Security note:** Interactive prompts (default) are most secure. Use `.env` only on trusted machines. Add `.env` to `.gitignore` (already done).

### Profile Management

Profiles store separate session states in:
- `~/.gpt5-pro-cli/default/` (default profile)
- `~/.gpt5-pro-cli/<profile>/` (named profiles)

Each profile maintains its own:
- Browser session
- Cookies
- Local storage

### Model Names

Supported model names (case-insensitive):
- `GPT-5 Pro` (default)
- `o1-pro`
- `GPT-4`
- `GPT-4 Turbo`

The tool attempts fuzzy matching with the ChatGPT UI.

## Known Limitations

- **First login requires manual CAPTCHA solving**: Google shows CAPTCHAs for automated logins - solve it once in visible mode
- **Session expires eventually**: Re-run `login` command when sessions expire (typically weeks)
- **UI changes may break selectors**: ChatGPT UI updates may require tool updates
- **No streaming output**: Full response displayed at once (not character-by-character)
- **Single conversation**: Each query starts a new chat (no conversation history)
