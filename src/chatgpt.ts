import { chromium, Page, Browser, BrowserContext, Locator } from 'playwright';
import { getCredentials } from './credentials.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { createRequire } from 'module';

export interface ChatGPTOptions {
  headless?: boolean;
  profile?: string;
  model?: string;
  timeout?: number;
  retries?: number;
  verbose?: boolean;
}

interface ModelPreStep {
  testId?: string;
  text?: string;
}

interface ModelDefinition {
  key: string;
  displayName: string;
  verifyTokens: string[];
  optionTestIds: string[];
  fallbackTexts: string[];
  preSteps?: ModelPreStep[];
}

export class ChatGPT {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private headless: boolean;
  private stateDir: string;
  private profile: string;
  private model: string;
  private timeout: number;
  private retries: number;
  private verbose: boolean;

  private modelDefinitions: Record<string, ModelDefinition> = this.buildModelDefinitions();

  constructor(options: ChatGPTOptions = {}) {
    this.headless = options.headless ?? false;
    this.profile = options.profile ?? 'default';
    this.model = options.model ?? 'gpt-5-pro';
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.verbose = options.verbose ?? false;
    this.stateDir = path.join(os.homedir(), '.gpt5-pro-cli', this.profile);
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (!this.verbose && level === 'info') {
      return;
    }
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '✓';
    console.log(`${prefix} ${message}`);
  }

  private debug(message: string) {
    if (this.verbose) {
      console.log(`[DEBUG] ${message}`);
    }
  }

  async initialize() {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }

    await this.ensureBrowserInstalled();

    this.debug(`Profile: ${this.profile}, State dir: ${this.stateDir}`);

    // Configure Playwright launch options
    const launchOptions: any = {
      headless: this.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',  // Required for Nix environments
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      timeout: this.timeout,
    };

    // Let Playwright use its own downloaded browsers - more reliable than Nix browsers on macOS
    this.debug(`Launching browser (headless: ${this.headless})...`);

    try {
      this.browser = await chromium.launch(launchOptions);
      this.debug('Browser launched successfully');
    } catch (error) {
      this.log(`Browser launch failed: ${error}`, 'error');
      throw error;
    }

    const statePath = path.join(this.stateDir, 'browser-state.json');
    const contextOptions: any = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    };

    if (fs.existsSync(statePath)) {
      this.log('Loading saved session...');
      contextOptions.storageState = statePath;
    }

    this.context = await this.browser.newContext({
      ...contextOptions,
      permissions: [
        'clipboard-read',
        'clipboard-write',
      ],
    });
    this.page = await this.context.newPage();

    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }

  private async ensureBrowserInstalled() {
    let executablePath = '';
    try {
      executablePath = chromium.executablePath();
    } catch (error) {
      this.debug(`chromium.executablePath() threw: ${error}`);
    }

    if (executablePath && fs.existsSync(executablePath)) {
      this.debug(`Chromium executable found at ${executablePath}`);
      return;
    }

    const message = 'Playwright Chromium browser not found; installing (first run may take a moment)...';
    if (this.verbose) {
      this.log(message, 'info');
    } else {
      console.log(`⬇️  ${message}`);
    }

    await this.installBrowserBinary();

    executablePath = chromium.executablePath();
    if (!executablePath || !fs.existsSync(executablePath)) {
      throw new Error('Unable to install Playwright Chromium browser automatically. Please run "npx playwright install chromium" and retry.');
    }

    if (!this.verbose) {
      console.log('✅ Playwright Chromium browser installed.');
    } else {
      this.log('Playwright Chromium browser installed.', 'info');
    }
  }

  private async installBrowserBinary() {
    const require = createRequire(import.meta.url);
    const playwrightPackageDir = path.dirname(require.resolve('playwright/package.json'));
    const cliPath = path.join(playwrightPackageDir, 'cli.js');

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
        stdio: this.verbose ? 'inherit' : 'pipe',
        env: process.env,
      });

      let stderr = '';

      if (!this.verbose) {
        child.stdout?.on('data', (data) => {
          const message = data.toString();
          this.debug(`playwright install stdout: ${message}`);
        });
        child.stderr?.on('data', (data) => {
          const message = data.toString();
          stderr += message;
          this.debug(`playwright install stderr: ${message}`);
        });
      }

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `playwright install exited with code ${code}`));
        }
      });
    });
  }

  async loginInteractive() {
    if (!this.page) throw new Error('Browser not initialized');

    const { email, password } = await getCredentials();

    this.log('Navigating to https://chatgpt.com/...');
    await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: this.timeout });
    await this.page.waitForTimeout(2000);

    const isLoggedIn = await this.checkIfLoggedIn();
    if (isLoggedIn) {
      this.log('Already logged in!');
      await this.saveSession();
      return;
    }

    this.log('Clicking login button...');
    await this.page.getByTestId('login-button').click();
    await this.page.waitForTimeout(2000);

    this.log('Entering email...');
    await this.page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await this.page.waitForTimeout(500);

    await this.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await this.page.waitForTimeout(3000);

    this.log('Entering password...');

    // Focus the password field
    const passwordField = this.page.getByRole('textbox', { name: 'Password' });
    await passwordField.click({ force: true });
    await this.page.waitForTimeout(500);

    // Clear any existing value
    await passwordField.clear();
    await this.page.waitForTimeout(500);

    // Type password slowly
    this.debug('Typing password with simulated delays');
    await passwordField.type(password, { delay: 50 });
    await this.page.waitForTimeout(500);

    // Get the actual value in the field to verify
    const fieldValue = await passwordField.inputValue();
    this.debug(`Password field length after fill: ${fieldValue.length} chars`);

    if (fieldValue.length !== password.length) {
      this.log(`Password field length mismatch (expected ${password.length}, got ${fieldValue.length})`, 'warn');
    }

    // Trigger blur to ensure validation runs
    await passwordField.blur();
    await this.page.waitForTimeout(500);

    // Submit password form (prefer button click, fall back to Enter)
    const submitPasswordButton = this.page.getByRole('button', { name: 'Continue', exact: true });
    let submitted = false;

    try {
      await submitPasswordButton.click({ timeout: 5000 });
      submitted = true;
      this.log('Submitting password...');
    } catch (error) {
      this.debug(`Continue button click failed (${String(error)}) - falling back to Enter`);
    }

    if (!submitted) {
      await passwordField.press('Enter');
      this.log('Submitting password with Enter key...');
    }

    await this.page.waitForTimeout(3000);

    // Take screenshot after submitting
    await this.page.screenshot({ path: '/tmp/after-password-submit.png', fullPage: true });
    this.log('Screenshot saved: /tmp/after-password-submit.png');

    // Check for email verification UI (inline on same page or URL change)
    this.log('Checking for email verification...');
    const otpSelectors = [
      'input[autocomplete="one-time-code"]',
      'input[data-testid*="otp" i]',
      'input[data-testid*="code" i]',
      'input[name*="code" i]',
      'input[inputmode="numeric"]',
      'input[type="tel"]',
      'input[type="text"][maxlength="1"]',
      'input[aria-label*="digit" i]'
    ];

    const codeInputs = await this.waitForOtpInputs(otpSelectors);

    if (codeInputs) {
      const visibleOtpCount = await codeInputs.count();
      this.debug(`Detected ${visibleOtpCount} OTP inputs`);

      this.log('Email verification required - check your email for code');
      const code = (await this.prompt2FA()).replace(/\s+/g, '');

      if (!code) {
        throw new Error('Verification code was empty');
      }

      this.log('Entering verification code...');
      await codeInputs!.first().click({ force: true });
      await this.page.waitForTimeout(200);

      if (visibleOtpCount <= 1) {
        await codeInputs!.first().fill('');
        await this.page.keyboard.type(code, { delay: 80 });
      } else {
        const digits = code.split('');
        const maxDigits = Math.min(digits.length, visibleOtpCount);

        for (let i = 0; i < maxDigits; i++) {
          const digitInput = codeInputs!.nth(i);
          await digitInput.fill('');
          await digitInput.type(digits[i], { delay: 40 });
          await this.page.waitForTimeout(40);
        }

        if (digits.length > visibleOtpCount) {
          this.log(
            `Verification code has ${digits.length} digits but only ${visibleOtpCount} inputs were detected. Extra digits were ignored.`,
            'warn'
          );
        }
      }

      await this.page.waitForTimeout(500);

      const submitSelectors = [
        'button:has-text("Continue")',
        'button:has-text("Verify")',
        'button:has-text("Submit")',
        'button:has-text("Next")',
        'button:has-text("Confirm")',
        'button[type="submit"]'
      ];

      let submitClicked = false;

      for (const selector of submitSelectors) {
        const buttonLocator = this.page.locator(`${selector}:visible`).first();

        if ((await buttonLocator.count()) > 0) {
          try {
            await buttonLocator.click({ timeout: 3000 });
            this.debug(`Clicked OTP submit button (${selector})`);
            submitClicked = true;
            break;
          } catch (error) {
            this.debug(`Failed to click ${selector}: ${String(error)}`);
          }
        }
      }

      if (!submitClicked) {
        this.debug('No visible submit button detected for OTP, pressing Enter instead');
        await this.page.keyboard.press('Enter');
      }
      await this.page.waitForTimeout(5000);
    } else {
      this.debug('No email verification prompt detected after password submission');
      if (this.verbose) {
        const textPreview = await this.page.evaluate(() => document.body.innerText.slice(0, 500));
        this.debug(`Page text preview: ${textPreview.replace(/\s+/g, ' ').trim()}`);
      }
    }

    this.log('Waiting for login to complete...');
    const loginSuccess = await this.waitForAuthenticatedSession();
    if (loginSuccess) {
      this.log('Logged in successfully!');
      await this.saveSession();
    } else {
      await this.page.screenshot({ path: '/tmp/login-failed.png', fullPage: true });
      throw new Error(`Login failed - could not find chat interface. URL: ${this.page.url()}. Screenshot: /tmp/login-failed.png`);
    }
  }

  private async prompt2FA(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('\nEnter your 2FA code: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  private async waitForOtpInputs(selectors: string[]): Promise<Locator | null> {
    if (!this.page) throw new Error('Browser not initialized');

    const otpSelector = selectors.map((selector) => `${selector}:visible`).join(', ');
    if (!otpSelector.trim()) return null;

    const pollIntervalMs = 500;
    const maxWaitMs = 45000;
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt++;

      const locator = this.page.locator(otpSelector);
      const count = await locator.count().catch(() => 0);

      if (count > 0) {
        this.debug(`OTP inputs detected after ${attempt} poll(s)`);
        return locator;
      }

      await this.tryTriggerVerificationStep(attempt);
      await this.page.waitForTimeout(pollIntervalMs);
    }

    this.debug('Timed out waiting for OTP inputs');
    return null;
  }

  private async tryTriggerVerificationStep(attempt: number): Promise<void> {
    if (!this.page) return;

    const triggerSelectors = [
      'button:has-text("Send code")',
      'button:has-text("Send me a code")',
      'button:has-text("Send verification code")',
      'button:has-text("Email code")',
      'button:has-text("Email me a code")',
      'button:has-text("Use email")',
      'button:has-text("Continue with email")',
      'button:has-text("Verify")',
      'button:has-text("Resend")',
      'button[data-testid*="email" i]'
    ];

    for (const selector of triggerSelectors) {
      const button = this.page.locator(`${selector}:visible`).first();

      if ((await button.count()) === 0) {
        continue;
      }

      try {
        await button.click({ timeout: 3000 });
        this.debug(`Clicked verification trigger (${selector}) on attempt ${attempt}`);
        await this.page.waitForTimeout(500);
        return;
      } catch (error) {
        this.debug(`Failed to click ${selector} during verification (attempt ${attempt}): ${String(error)}`);
      }
    }
  }

  async checkSession(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');

    this.log('Checking session...');
    await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: this.timeout });
    await this.page.waitForTimeout(3000);

    return await this.checkIfLoggedIn();
  }

  async selectModel(modelName: string = this.model): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    this.log(`Selecting model: ${modelName}`);

    const definition = this.resolveModelDefinition(modelName);
    if (!definition) {
      this.log(`Model "${modelName}" is not recognized; skipping model switch`, 'warn');
      return;
    }

    const trigger = this.page.locator('button[data-testid="model-switcher-dropdown-button"]:visible').first();

    if (await this.isModelAlreadySelected(trigger, definition)) {
      this.debug(`Already using ${modelName}`);
      return;
    }

    await this.ensureComposerReady();

    try {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click({ timeout: 5000 });
      await this.page.waitForSelector('[role="menu"], [data-state="open"]', { timeout: 3000 });
      this.debug('Model picker opened');
    } catch (error) {
      this.log(`Failed to open model picker: ${error}`, 'warn');
      return;
    }

    const applied = await this.applyModelSelection(definition);
    if (!applied) {
      this.log(`Could not find model option for ${modelName}`, 'warn');
      await this.page.keyboard.press('Escape').catch(() => {});
      return;
    }

    await this.page.waitForTimeout(1200);

    const confirmed = await this.isModelAlreadySelected(trigger, definition);
    if (confirmed) {
      this.log(`Model ${definition.displayName} selected successfully`);
    } else {
      const label = (await trigger.textContent())?.trim() ?? '(unavailable)';
      this.debug(`Model picker label after selection: ${label}`);
      this.log(`Triggered ${definition.displayName} selection (confirmation unavailable)`);
    }
  }

  private async ensureComposerReady(): Promise<void> {
    if (!this.page) return;

    const selectors = [
      '[data-testid="composer"]',
      'textarea#prompt-textarea',
      'textarea[placeholder*="Ask anything" i]',
      'textarea[placeholder*="Message" i]',
      'div[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 5000 });
        return;
      } catch {
        continue;
      }
    }

    this.debug('Composer did not load within expected time');
  }

  private buildModelDefinitions(): Record<string, ModelDefinition> {
    return {
      'gpt-5': {
        key: 'gpt-5',
        displayName: 'GPT-5 Auto',
        verifyTokens: ['chatgpt 5', 'gpt-5'],
        optionTestIds: ['model-switcher-gpt-5'],
        fallbackTexts: ['GPT-5', 'Auto']
      },
      'gpt-5-auto': {
        key: 'gpt-5-auto',
        displayName: 'GPT-5 Auto',
        verifyTokens: ['chatgpt 5', 'gpt-5'],
        optionTestIds: ['model-switcher-gpt-5'],
        fallbackTexts: ['GPT-5', 'Auto']
      },
      'gpt-5-instant': {
        key: 'gpt-5-instant',
        displayName: 'GPT-5 Instant',
        verifyTokens: ['instant'],
        optionTestIds: ['model-switcher-gpt-5-instant'],
        fallbackTexts: ['Instant']
      },
      'gpt-5-thinking': {
        key: 'gpt-5-thinking',
        displayName: 'GPT-5 Thinking',
        verifyTokens: ['thinking'],
        optionTestIds: ['model-switcher-gpt-5-thinking'],
        fallbackTexts: ['Thinking']
      },
      'gpt-5-pro': {
        key: 'gpt-5-pro',
        displayName: 'GPT-5 Pro',
        verifyTokens: ['pro'],
        optionTestIds: ['model-switcher-gpt-5-pro'],
        fallbackTexts: ['Pro']
      },
      'gpt-4o': {
        key: 'gpt-4o',
        displayName: 'GPT-4o',
        verifyTokens: ['gpt-4o'],
        optionTestIds: ['model-switcher-gpt-4o'],
        fallbackTexts: ['GPT-4o'],
        preSteps: [{ testId: 'Legacy models-submenu' }]
      },
      'gpt-4o-mini': {
        key: 'gpt-4o-mini',
        displayName: 'GPT-4o mini',
        verifyTokens: ['gpt-4o mini', 'mini'],
        optionTestIds: ['model-switcher-gpt-4o-mini'],
        fallbackTexts: ['GPT-4o mini'],
        preSteps: [{ testId: 'Legacy models-submenu' }]
      }
    } as const;
  }

  private resolveModelDefinition(modelName: string): ModelDefinition | null {
    const normalized = modelName.trim().toLowerCase().replace(/[\s_]+/g, '-');
    const aliasMap: Record<string, string> = {
      'chatgpt-5': 'gpt-5',
      'gpt5': 'gpt-5',
      'gpt5-auto': 'gpt-5',
      'gpt5-pro': 'gpt-5-pro',
      'gpt5-instant': 'gpt-5-instant',
      'gpt5-thinking': 'gpt-5-thinking',
      'gpt-5auto': 'gpt-5',
      'gpt-5pro': 'gpt-5-pro',
      'gpt-5instant': 'gpt-5-instant',
      'gpt-5thinking': 'gpt-5-thinking',
      'gpt-4': 'gpt-4o',
      'gpt4': 'gpt-4o',
      'gpt4o': 'gpt-4o',
      'gpt4omini': 'gpt-4o-mini',
      'gpt-4omini': 'gpt-4o-mini',
      'gpt-4o-mini': 'gpt-4o-mini',
      'gpt-4o-mini-high': 'gpt-4o-mini'
    };

    const key = aliasMap[normalized] ?? normalized;
    return this.modelDefinitions[key] ?? null;
  }

  private async isModelAlreadySelected(trigger: Locator, definition: ModelDefinition): Promise<boolean> {
    try {
      const labelRaw = await trigger.textContent();
      if (!labelRaw) return false;
      const label = labelRaw.toLowerCase();
      return definition.verifyTokens.some((token: string) => label.includes(token));
    } catch {
      return false;
    }
  }

  private async applyModelSelection(definition: ModelDefinition): Promise<boolean> {
    if (!this.page) return false;

    const steps = definition.preSteps ?? [];
    for (const step of steps) {
      let stepLocator: Locator | null = null;
      if (step.testId) {
        stepLocator = this.page.locator(`[data-testid="${step.testId}"]:visible`).first();
      } else if (step.text) {
        stepLocator = this.page.locator(`div.__menu-item:has-text("${step.text}")`).first();
      }

      if (!stepLocator || (await stepLocator.count()) === 0) {
        this.debug(`Pre-step "${JSON.stringify(step)}" not found when switching model`);
        continue;
      }

      try {
        await stepLocator.click({ timeout: 2000 });
        await this.page.waitForTimeout(250);
      } catch (error) {
        this.debug(`Failed to execute pre-step ${JSON.stringify(step)}: ${String(error)}`);
      }
    }

    const tryClickable = async (locator: Locator): Promise<boolean> => {
      if ((await locator.count()) === 0) return false;
      try {
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ timeout: 3000 });
        return true;
      } catch (error) {
        this.debug(`Failed to click model option locator: ${String(error)}`);
        return false;
      }
    };

    for (const testId of definition.optionTestIds ?? []) {
      const locator = this.page.locator(`[data-testid="${testId}"]:visible`).first();
      if (await tryClickable(locator)) {
        return true;
      }
    }

    for (const text of definition.fallbackTexts ?? []) {
      const locator = this.page.locator(`div.__menu-item:has-text("${text}")`).first();
      if (await tryClickable(locator)) {
        return true;
      }
    }

    return false;
  }

  private async saveSession() {
    if (!this.context) return;

    const statePath = path.join(this.stateDir, 'browser-state.json');
    await this.context.storageState({ path: statePath });
    this.log('Session saved for future use');
  }

  async query(prompt: string): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');

    // Select model before querying
    await this.selectModel();

    this.log('Submitting prompt...');

    // Wait for input to be ready
    const inputSelector = 'textarea#prompt-textarea, textarea[placeholder*="Message" i], div[contenteditable="true"]';
    await this.page.waitForSelector(inputSelector, { timeout: 10000 });

    // Get initial message count
    const initialMessages = await this.page.locator('[data-message-author-role="assistant"]').count();
    this.debug(`Initial assistant messages: ${initialMessages}`);

    // Fill and submit
    await this.page.fill(inputSelector, prompt);
    await this.page.waitForTimeout(500);
    await this.page.keyboard.press('Enter');

    this.log('Waiting for response...');

    const responseTimeout = this.getResponseTimeout();
    const pollIntervalMs = 2000;
    const responseDeadline = Date.now() + responseTimeout;

    while (Date.now() < responseDeadline) {
      const currentCount = await this.page.locator('[data-message-author-role="assistant"]').count();
      if (currentCount > initialMessages) {
        this.debug(`New assistant message detected (${currentCount} > ${initialMessages})`);
        break;
      }

      if (this.verbose) {
        const thinking = await this.page.evaluate(() =>
          document.body.innerText.includes('Pro thinking') || document.body.innerText.includes('Thinking')
        );
        if (thinking) {
          this.log('Assistant is still thinking...', 'info');
        }
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }

    const confirmedCount = await this.page.locator('[data-message-author-role="assistant"]').count();
    if (confirmedCount <= initialMessages) {
      throw new Error(`Response timeout after ${responseTimeout}ms`);
    }

    // Wait for response to stabilize
    let previousLength = 0;
    let stableCount = 0;
    const requiredStableChecks = 3;

    while (Date.now() < responseDeadline) {
      await this.page.waitForTimeout(2000);

      const messages = await this.page.locator('[data-message-author-role="assistant"]').all();
      if (messages.length === 0) {
        this.debug('Assistant message collection empty, waiting...');
        continue;
      }

      const lastMessage = messages[messages.length - 1];
      const currentText = await lastMessage.evaluate((node) => (node as HTMLElement).innerText || '');
      const trimmedText = currentText.trim();
      const currentLength = trimmedText.length;

      if (currentLength === 0) {
        if (this.verbose) {
          this.log('Assistant response not ready yet, continuing to wait...', 'info');
        }
        previousLength = 0;
        stableCount = 0;
        continue;
      }

      if (currentLength === previousLength) {
        stableCount++;
        this.debug(`Response length stable at ${currentLength} characters (${stableCount}/${requiredStableChecks})`);
      } else {
        this.debug(`Response length changed (${previousLength} -> ${currentLength})`);
        previousLength = currentLength;
        stableCount = 0;
      }

      if (stableCount >= requiredStableChecks) {
        if (trimmedText.length === 0) {
          throw new Error('Empty response received');
        }

        const copied = await this.copyAssistantResponse(lastMessage);
        if (copied && copied.trim().length > 0) {
          return copied.trim();
        }

        return trimmedText;
      }
    }

    throw new Error(`Response timeout after ${responseTimeout}ms`);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private async waitForAuthenticatedSession(maxWaitMs: number = 90000): Promise<boolean> {
    if (!this.page) return false;

    const sessionCookieNames = new Set([
      '__Secure-next-auth.session-token',
      'next-auth.session-token',
      '__Secure-openai-session-token',
      'openai-session',
    ]);

    try {
      await this.page.waitForURL(/chatgpt\.com/i, { timeout: maxWaitMs }).catch(() => undefined);
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        const hasSessionCookie = this.context
          ? (await this.context.cookies('https://chatgpt.com')).some((cookie) =>
              sessionCookieNames.has(cookie.name)
            )
          : false;

        const domLoggedIn = await this.page.evaluate(() => {
          const data = (window as any).__NEXT_DATA__;
          const props = data?.props?.pageProps;
          const user = props?.user || props?.session?.user || props?.account;
          if (user) return true;

          const composer = document.querySelector('[data-testid="composer"] textarea, textarea#prompt-textarea');
          const hasHistorySection =
            document.body.innerText.includes('New chat') &&
            (document.body.innerText.includes('Search chats') || document.body.innerText.includes('GPTs'));
          const hasProBadge = document.body.innerText.includes('Pro');
          const hasTemporaryBanner = document.body.innerText.includes('Temporary Chat');

          return Boolean(composer && (hasHistorySection || hasProBadge) && !hasTemporaryBanner);
        });

        if (hasSessionCookie || domLoggedIn) {
          this.debug(
            `Authenticated session detected (cookie=${hasSessionCookie}, dom=${domLoggedIn}) after ${
              Date.now() - start
            }ms`
          );
          return true;
        }

        await this.page.waitForTimeout(1000);
      }
    } catch (error) {
      this.debug(`waitForAuthenticatedSession error: ${String(error)}`);
    }

    this.debug('waitForAuthenticatedSession timed out');
    return false;
  }

  private async checkIfLoggedIn(): Promise<boolean> {
    if (!this.page) return false;

    try {
      const hasSession = await this.page.evaluate(() => {
        const data = (window as any).__NEXT_DATA__;
        const props = data?.props?.pageProps;
        const user = props?.user || props?.session?.user || props?.account;
        if (user) return true;

        const composer = document.querySelector('[data-testid="composer"] textarea, textarea#prompt-textarea');
        const history = document.body.innerText.includes('Search chats') || document.body.innerText.includes('New chat');
        const notTemporary = !document.body.innerText.includes('Temporary Chat');

        return Boolean(composer && history && notTemporary);
      });

      if (hasSession) {
        this.debug('Detected authenticated session payload');
        return true;
      }
    } catch (error) {
      this.debug(`Failed to inspect __NEXT_DATA__: ${String(error)}`);
    }

    if (this.context) {
      const sessionCookieNames = new Set([
        '__Secure-next-auth.session-token',
        'next-auth.session-token',
        '__Secure-openai-session-token',
        'openai-session',
      ]);

      const cookies = await this.context.cookies('https://chatgpt.com');
      if (cookies.some((cookie) => sessionCookieNames.has(cookie.name))) {
        this.debug('Detected authenticated session via cookies');
        return true;
      }
    }

    return false;
  }

  private getResponseTimeout(): number {
    const base = this.timeout;
    const longRunningModels = [
      'gpt-5',
      'gpt5',
      'gpt-5-pro',
      'gpt5-pro',
      'gpt-5-thinking',
      'gpt5-thinking'
    ];
    const normalizedModel = this.model.toLowerCase().replace(/[\s_]+/g, '-');
    const requiresLongTimeout = longRunningModels.some((name) => normalizedModel.includes(name));
    const minimum = requiresLongTimeout ? 30 * 60 * 1000 : 0; // 30 minutes
    return Math.max(base, minimum);
  }

  private async copyAssistantResponse(message: Locator): Promise<string | null> {
    if (!this.page) return null;

    try {
      await message.scrollIntoViewIfNeeded();
      await message.hover({ timeout: 2000 }).catch(() => {});
      await this.page.waitForTimeout(150);

      let copyButton = message.locator('[data-testid="copy-turn-action-button"]').first();

      if ((await copyButton.count()) === 0) {
        const messageId = await message.getAttribute('data-message-id');
        if (messageId) {
          copyButton = this.page.locator(`[data-testid="copy-turn-action-button"][data-message-id="${messageId}"]`).first();
        }
      }

      if ((await copyButton.count()) === 0) {
        copyButton = this.page.locator('[data-testid="copy-turn-action-button"]:visible').last();
      }

      if ((await copyButton.count()) === 0) {
        this.debug('Copy button not found for assistant message');
        return null;
      }

      await copyButton.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});

      const before = await this.page.evaluate(async () => {
        try {
          return await navigator.clipboard.readText();
        } catch (error) {
          return null;
        }
      });

      await copyButton.hover({ timeout: 2000 }).catch(() => {});
      await copyButton.click({ timeout: 3000 });

      const timeout = Date.now() + 3000;
      let clip: string | null = null;

      while (Date.now() < timeout) {
        clip = await this.page.evaluate(async () => {
          try {
            return await navigator.clipboard.readText();
          } catch (error) {
            return null;
          }
        });

        if (clip && clip.trim().length > 0 && clip !== before) {
          break;
        }

        await this.page.waitForTimeout(150);
      }

      if (!clip || clip.trim().length === 0) {
        this.debug('Clipboard returned empty or unchanged content after copy');
        return null;
      }

      return clip;
    } catch (error) {
      this.debug(`Failed to copy assistant response: ${String(error)}`);
      return null;
    }
  }
}
