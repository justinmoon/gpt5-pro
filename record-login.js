// Quick script to record the login flow
const { chromium } = require('playwright');

(async () => {
  console.log('Starting browser with recorder...');
  console.log('');
  console.log('Instructions:');
  console.log('1. Perform the EXACT login flow you normally do');
  console.log('2. Go to https://chatgpt.com');
  console.log('3. Click login button');
  console.log('4. Enter your email');
  console.log('5. Click continue');
  console.log('6. Enter password');
  console.log('7. Stop when you see the 2FA prompt (DO NOT enter 2FA code)');
  console.log('8. Close the browser when done');
  console.log('');
  console.log('The code will be saved to recorded-flow.txt');
  console.log('');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Start recording
  await page.goto('https://chatgpt.com');
  
  console.log('Browser opened. Perform your login flow now...');
  console.log('Press Ctrl+C here when done to see the recorded actions.');
  
  // Keep the script running
  await new Promise(() => {});
})();
